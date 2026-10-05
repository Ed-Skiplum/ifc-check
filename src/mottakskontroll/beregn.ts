/** The mottakskontroll report's computed round, from what the browser already
 * measured: the port of `beregn()` in `mottakskontroll/bygg_mottakskontroll.py`,
 * fed by the report contract rows (`BoardData.rows`), the model profile and
 * the ruleset instead of the Python caches.
 *
 * A MAPPING onto the Python report's shape, never a second engine. Every
 * number is a field of a contract row or a count over the profile's product
 * rows; the verdicts are the Python report's own rules over those numbers
 * (`verdikt_fra`, `guid_verdikt`, `etasjedefinisjon_verdikt`, `kpi_lys`).
 *
 * What the browser does not measure is never filled in:
 *
 *   - The round config (Firma, Dalux-versjon, Opplastingsdato, Eksport) and
 *     the file's SHA256: empty, as the Python report prints an absent key.
 *   - The project register's own requirements (the hygiene strip), its
 *     comments (`merknader`), its use cases (`bruk`): absent from a ruleset,
 *     so left out, as a standard-only Python run leaves them out.
 *   - GUIDs shared with other models (`Delt med andre modeller`, GUID på
 *     tvers): «–».
 *   - Produkt and Materiale are ONE contract row (`material-product`). Its
 *     sources and findings split Dekning per branch; its value distribution
 *     does not split, so their Fordeling is «–», Materiale's Gyldig is «–»,
 *     and Materiale's verdict, which needs that Gyldig, is `ukjent`.
 *
 * `ukjent` is the verdict the numbers cannot decide (a row the engine could
 * not evaluate, a Gyldig it does not measure). The Python report has no word
 * for it; it prints the `[WRITE]` sentinel. */

import type { ReportRow } from "../engine/report.ts";
import type { IfcSummary } from "../engine/types";
import { matchStoreys, resolveStoreyRules, type StoreyMatch } from "../engine/storey-config.ts";
import { modelFact, modelLabel, roleRule, storeyPolicy } from "../ids/models.ts";
import type { MappingRole, Ruleset } from "../ids/types.ts";
import type { ModelProfile } from "../ui/profile.ts";
import { fmtPct, n_, p_, pct } from "./fmt.ts";
import {
  BLOKKER,
  E,
  KPI_BAND,
  KPI_TERSKLER,
  KPI_TITLER,
  TERSKEL,
  TERSKEL_GYLDIG,
  type BlokkDef,
  type BlokkId,
  type KpiId,
  type KpiTerskel,
  type Terskel,
  type Verdikt,
} from "./standard.ts";

export type Status = "ok" | "warn" | "bad" | "na";
export type BlokkVerdikt = Verdikt | "ukjent";

export const SENTINEL = "[WRITE]";

export const VERDIKT_STATUS: Record<BlokkVerdikt, Status> = {
  oppfylt: "ok",
  kan_brukes: "warn",
  ikke_oppfylt: "bad",
  gjelder_ikke: "na",
  ikke_konfigurert: "na",
  ukjent: "na",
};

export interface Sted {
  navn: string;
  nivaa: "standard" | "prosjekt";
}

/** One reading of one requirement, the fields `html_rad` prints. */
export interface Rad {
  sted: Sted[];
  /** [x, N]: the objects carrying the property, of those that should. */
  tilstede: [number, number];
  /** [valid, unique values]; null where the block prints no Gyldig number. */
  gyldig: [number, number] | null;
  /** Distinct values found; null where the browser cannot tell them apart. */
  unike: number | null;
  grunnlag_tekst: string;
}

export interface Blokk {
  id: BlokkId;
  tittel: string;
  seksjon: string;
  krav_tekst: string;
  verdikt: BlokkVerdikt;
  rad: Rad | null;
  /** On Produkt and Materiale: the open mengdetype rulings that touch
   *  objects. The switch's branch count (the Python report's `bryter`) is not
   *  carried: mengdetype is assessed, not reported. */
  aapne: string[];
}

export type EtasjeKode =
  | "som_registeret"
  | "feil_navn"
  | "koteavvik"
  | "mangler"
  | "andre_nivaaer"
  | "ikke_konfigurert";

export interface EtasjeRad {
  kode: EtasjeKode;
  k_navn: string;
  /** mm; null where there is no configured level, or no elevation. */
  k_kote: number | null;
  m_navn: string;
  m_kote: number | null;
}

export interface Etasjematrise {
  rader: EtasjeRad[];
  toleranse: { over: number | null; under: number | null };
  referanse: string;
}

export interface Kpi {
  id: KpiId;
  tittel: string;
  tekst: string;
  under: string;
  status: Status | "";
}

export interface Modell {
  label: string;
  kort: string;
  fag: string;
  /** The round config's fields: the browser has no round config. */
  firma: string;
  versjon: string;
  lastet_opp: string;
  eksport: string;
  /** The counted objects; null when no contract row carries the count. */
  n: number | null;
  schema: string;
  kpi: Kpi[];
  skjema: { skrevet: string; verdikt: BlokkVerdikt; godtatt: string };
  guid: { verdikt: BlokkVerdikt; duplikater: number | null };
  etasjer: { verdikt: BlokkVerdikt; em: Etasjematrise };
  /** All eleven, in standard.yaml's order; GUID and Etasjedefinisjon carry no
   *  `rad`, they print as components. */
  blokker: Blokk[];
}

export interface Runde {
  /** The ruleset's title or name; null with no ruleset loaded. */
  prosjektNavn: string | null;
  dato: string;
  eksport: string;
  modeller: Modell[];
  /** The ruleset configures Kopiobjekt, so the Python report would print GUID
   *  på tvers; the browser does not measure it. */
  guidPaaTvers: boolean;
}

export interface ModellInput {
  fileName: string;
  rows: readonly ReportRow[];
  summary: IfcSummary;
  profile?: ModelProfile;
}

/* -------------------------------------------------------------- verdicts */

export function lys(p: number, t: Terskel): Status {
  return p >= t.ok ? "ok" : p >= t.warn ? "warn" : "bad";
}

/** `verdikt_fra`: Dekning and Gyldig against their thresholds. */
function verdiktFra(tilstede: [number, number], gyldig: [number, number] | null): Verdikt {
  if (tilstede[1] === 0) return "gjelder_ikke";
  const lysene = [lys(pct(tilstede[0], tilstede[1]), TERSKEL)];
  if (gyldig && gyldig[1]) lysene.push(lys(pct(gyldig[0], gyldig[1]), TERSKEL_GYLDIG));
  if (lysene.includes("bad")) return "ikke_oppfylt";
  if (lysene.includes("warn")) return "kan_brukes";
  return "oppfylt";
}

function kpiLys(verdi: number | null, t: KpiTerskel | undefined): Status | "" {
  if (verdi === null || !t) return "";
  if (t.retning === "lav") return verdi < t.gronn ? "ok" : verdi <= t.gul ? "warn" : "bad";
  return verdi >= t.gronn ? "ok" : verdi >= t.gul ? "warn" : "bad";
}

/* ----------------------------------------------------------------- rows */

function rowOf(rows: readonly ReportRow[], spec: { id?: string; mapping?: MappingRole }): ReportRow | null {
  if (spec.mapping) return rows.find((r) => r.mapping === spec.mapping) ?? null;
  return rows.find((r) => r.id === spec.id && !r.mapping) ?? null;
}

const KILDE: Partial<Record<BlokkId, { id?: string; mapping?: MappingRole }>> = {
  etasjer: { id: "storey-containment" },
  systemkode: { mapping: "system-classification" },
  funksjonskode: { mapping: "component-classification" },
  kopiobjekt: { mapping: "copy-object" },
  mmi: { mapping: "progress-code" },
  fase: { id: "phase" },
};

function stederOf(row: ReportRow, gren?: string): Sted[] {
  return row.dekning.kilder
    .filter((k) => (gren ? k.gren === gren : k.gren === undefined))
    .map((k) => ({ navn: k.navn, nivaa: k.lag }));
}

/** Distinct values of a distribution: the values found, not the objects
 *  without one, and not the open rulings that ride on it. */
function verdier(row: ReportRow) {
  return (row.fordeling ?? []).filter((v) => v.verdi !== null && v.flagg !== "åpen");
}

type Lesing = Pick<Blokk, "verdikt" | "rad">;

/** A row with no reading: not configured, not applicable, or not evaluable. */
function utenLesing(row: ReportRow | null): Lesing | null {
  if (!row || row.state === "not_configured") return { verdikt: "ikke_konfigurert", rad: null };
  if (row.state === "not_evaluable") return { verdikt: "ukjent", rad: null };
  const d = row.dekning;
  if (d.oppfylt === null || d.avvik === null || d.mangler === null) {
    return { verdikt: row.state === "not_applicable" ? "gjelder_ikke" : "ukjent", rad: null };
  }
  return null;
}

/** One requirement read off its contract row (`lesing` + `krav`). */
function lesRad(def: BlokkDef, row: ReportRow | null): Lesing {
  const ingen = utenLesing(row);
  if (ingen || !row) return ingen ?? { verdikt: "ikke_konfigurert", rad: null };
  const d = row.dekning;
  const o = d.oppfylt as number;
  const a = d.avvik as number;
  const m = d.mangler as number;
  // Where accepted values are declared, a carried but invalid value is
  // present; Gyldig judges it (`tilstede`).
  const tilstede: [number, number] = [o + (def.verdiliste ? a : 0), o + a + m];
  let gyldig: [number, number] | null = null;
  let verdikt: BlokkVerdikt;
  if (def.verdiliste && row.fordeling === null) {
    // No distribution, so no Gyldig: decided only when nothing was carried.
    verdikt = o + a === 0 ? verdiktFra(tilstede, null) : "ukjent";
  } else {
    if (def.verdiliste) {
      const v = verdier(row);
      gyldig = [v.filter((x) => x.flagg !== "avvik").length, v.length];
    }
    verdikt = verdiktFra(tilstede, gyldig);
  }
  return {
    verdikt,
    rad: {
      sted: stederOf(row),
      tilstede,
      gyldig,
      unike: row.fordeling === null ? null : verdier(row).length,
      grunnlag_tekst: E("objekter"),
    },
  };
}

/** Typeobjekt over every product row of the file, as the Python block reads
 *  it: a type with a name is oppfylt, a type without one avvik, no type
 *  mangler; its values are the types by class and name. */
function lesTypeobjekt(profile: ModelProfile | undefined): Lesing {
  const rows = profile?.rows;
  if (!rows || rows.some((r) => r.typed === undefined)) return { verdikt: "ukjent", rad: null };
  let navngitt = 0;
  const typer = new Set<string>();
  for (const r of rows) {
    if (!r.typed) continue;
    const navn = (r.typeName ?? "").trim();
    if (navn) navngitt++;
    typer.add(`${r.typeEntity ?? ""}\u0000${navn}`);
  }
  const tilstede: [number, number] = [navngitt, rows.length];
  return {
    verdikt: verdiktFra(tilstede, null),
    rad: {
      sted: [{ navn: "IfcRelDefinesByType", nivaa: "standard" }],
      tilstede,
      gyldig: null,
      unike: rows.some((r) => r.typed && r.typeEntity === undefined) ? null : typer.size,
      grunnlag_tekst: "IfcProduct",
    },
  };
}

/** Produkt and Materiale off the one `material-product` row: Dekning per
 *  branch from the branch's sources and the row's finding codes. */
function lesGren(def: BlokkDef, row: ReportRow | null): Pick<Blokk, "verdikt" | "rad" | "aapne"> {
  const tom = { aapne: [] };
  const ingen = utenLesing(row);
  if (ingen || !row) return { ...(ingen ?? { verdikt: "ukjent", rad: null }), ...tom };
  const gren = def.id === "produkt" ? "telleobjekt" : "mengdeobjekt";
  const kilder = row.dekning.kilder.filter((k) => k.gren === gren);
  if (kilder.some((k) => k.n === null)) return { verdikt: "ukjent", rad: null, ...tom };
  const funnet = kilder.reduce((s, k) => s + (k.n as number), 0);
  const funn = (kode: string) => row.funn.filter((f) => f.grunn === kode).length;
  const mangler = funn(gren === "telleobjekt" ? "product-missing" : "material-missing");
  const tilstede: [number, number] = [funnet, funnet + mangler];
  // Materiale's Gyldig reads the material values, which the row's
  // distribution mixes with the products: decided only when none was carried.
  const verdikt: BlokkVerdikt =
    def.verdiliste && funnet > 0 ? "ukjent" : verdiktFra(tilstede, null);
  const aapne = (row.aapne ?? []).flatMap((r) =>
    r.n === null ? [r.tittel] : r.n > 0 ? [`${r.tittel} ×${n_(r.n)}`] : [],
  );
  return {
    verdikt,
    rad: {
      sted: stederOf(row, gren),
      tilstede,
      gyldig: null,
      unike: null,
      grunnlag_tekst: E(gren === "telleobjekt" ? "telleobjekter" : "mengdeobjekter"),
    },
    aapne,
  };
}

/** GUID: duplicates in the file decide, binary (`guid_verdikt`). Python's
 *  count is the extra occurrences, `sum(c - 1)`; the row's distribution
 *  counts objects per GlobalId multiplicity, so k objects in groups of k
 *  are n/k groups with k-1 extra each. */
function lesGuid(row: ReportRow | null): Modell["guid"] {
  const ingen = utenLesing(row);
  if (ingen || !row || row.fordeling === null) return { verdikt: ingen?.verdikt ?? "ukjent", duplikater: null };
  let dup = 0;
  for (const v of row.fordeling) {
    const k = Number(v.verdi);
    if (k > 1) dup += (v.n / k) * (k - 1);
  }
  return { verdikt: dup === 0 ? "oppfylt" : "ikke_oppfylt", duplikater: dup };
}

/** `etasjedefinisjon_verdikt`. */
function etasjeVerdikt(em: Etasjematrise): Verdikt {
  let verst: Verdikt = "oppfylt";
  for (const r of em.rader) {
    if (r.kode === "andre_nivaaer" || r.kode === "feil_navn") return "ikke_oppfylt";
    if (r.kode === "koteavvik" && r.m_kote !== null && r.k_kote !== null) {
      const d = r.m_kote - r.k_kote;
      const grense = d > 0 ? em.toleranse.over : em.toleranse.under;
      if (grense !== null && Math.abs(d) > 2 * grense) return "ikke_oppfylt";
      verst = "kan_brukes";
    }
  }
  return verst;
}

/** The etasjematrise: the configured levels against the file's storeys, by
 *  the storey-config check's own matching (`matchStoreys`). A level no storey
 *  reached is mangler; a storey that reached none, or a level already taken,
 *  is andre nivåer. A name that matches only after trimming is feil navn, as
 *  the check reads it. */
function lesEtasjer(input: ModellInput, ruleset: Ruleset | null, row: ReportRow | null): Modell["etasjer"] {
  const setup = ruleset?.storeys;
  const storeys = input.profile?.storeys ?? [];
  const skala = input.summary.unit_resolved ? input.summary.unit_scale : null;
  const kote = (e: number | null) => (e === null || skala === null ? null : Math.round(e * skala * 1000));
  const policy = storeyPolicy(ruleset, input.fileName);
  const levels = setup?.levels ?? [];
  if (!row || row.state === "not_configured" || !policy || levels.length === 0) {
    return {
      verdikt: "ikke_konfigurert",
      em: {
        rader: storeys.map((s) => ({ kode: "ikke_konfigurert", k_navn: "", k_kote: null, m_navn: s.name ?? "", m_kote: kote(s.elevation) })),
        toleranse: { over: null, under: null },
        referanse: "",
      },
    };
  }
  const tomt = (verdikt: BlokkVerdikt): Modell["etasjer"] => ({
    verdikt,
    em: { rader: [], toleranse: { over: setup!.tolerance.aboveMm, under: setup!.tolerance.belowMm }, referanse: setup!.reference ?? "" },
  });
  if (row.state === "not_applicable") return tomt("gjelder_ikke");
  if (row.state === "not_evaluable" || skala === null || !input.profile) return tomt("ukjent");

  const { rules } = resolveStoreyRules(policy, storeys, skala, levels);
  const matches = matchStoreys(storeys, skala, levels, rules);
  const valgt = new Map<number, StoreyMatch>();
  const andre: StoreyMatch[] = [];
  for (const m of matches) {
    if (m.config === null || m.state === "not-in-config" || m.state === "duplicate" || valgt.has(m.config)) andre.push(m);
    else valgt.set(m.config, m);
  }
  const KODE: Partial<Record<StoreyMatch["state"], EtasjeKode>> = {
    match: "som_registeret",
    "elevation-mismatch": "koteavvik",
    "name-mismatch": "feil_navn",
    whitespace: "feil_navn",
  };
  const rader: EtasjeRad[] = levels.map((l, i) => {
    const m = valgt.get(i);
    const k_kote = Math.round(l.elevation * 1000);
    if (!m) return { kode: "mangler", k_navn: l.name, k_kote, m_navn: "", m_kote: null };
    return { kode: KODE[m.state] ?? "andre_nivaaer", k_navn: l.name, k_kote, m_navn: m.storey.name ?? "", m_kote: kote(m.storey.elevation) };
  });
  for (const m of andre) {
    rader.push({ kode: "andre_nivaaer", k_navn: "", k_kote: null, m_navn: m.storey.name ?? "", m_kote: kote(m.storey.elevation) });
  }
  const em: Etasjematrise = {
    rader,
    toleranse: { over: rules.tolerance.aboveMm, under: rules.tolerance.belowMm },
    referanse: setup?.reference ?? "",
  };
  return { verdikt: etasjeVerdikt(em), em };
}

/** The Nøkkeltall band (`kpi_band` / `kpi_kort`): over every product row,
 *  types by class and name. */
function lesKpi(profile: ModelProfile | undefined): Kpi[] {
  const rows = profile?.rows;
  const malt = rows !== undefined && rows.every((r) => r.typed !== undefined && (!r.typed || r.typeEntity !== undefined));
  const tall: Record<KpiId, number | null> = {
    antall_typer: null,
    antall_elementer: rows ? rows.length : null,
    instanser_per_type_alle: null,
    typer_med_en_instans_alle: null,
    utypede_instanser: null,
  };
  const tekst: Record<KpiId, [string, string]> = {
    antall_typer: ["–", ""],
    antall_elementer: [rows ? n_(rows.length) : "–", "IfcProduct"],
    instanser_per_type_alle: ["–", ""],
    typer_med_en_instans_alle: ["–", ""],
    utypede_instanser: ["–", ""],
  };
  if (rows && malt) {
    const per = new Map<string, number>();
    for (const r of rows) {
      if (!r.typed) continue;
      const k = `${r.typeEntity ?? ""}\u0000${(r.typeName ?? "").trim()}`;
      per.set(k, (per.get(k) ?? 0) + 1);
    }
    const typer = per.size;
    const typede = [...per.values()].reduce((s, c) => s + c, 0);
    const en = [...per.values()].filter((c) => c === 1).length;
    const nAlle = rows.length;
    const utypet = nAlle - typede;
    tall.antall_typer = typer;
    tall.instanser_per_type_alle = typer ? typede / typer : null;
    tall.typer_med_en_instans_alle = typer ? pct(en, typer) : null;
    tall.utypede_instanser = nAlle ? pct(utypet, nAlle) : null;
    tekst.antall_typer = [n_(typer), ""];
    tekst.instanser_per_type_alle = [typer ? fmtPct(typede / typer) : "–", `${n_(typede)} / ${n_(typer)}`];
    tekst.typer_med_en_instans_alle = [n_(en), typer ? p_(pct(en, typer)) : ""];
    tekst.utypede_instanser = [n_(utypet), nAlle ? p_(pct(utypet, nAlle)) : ""];
  }
  return KPI_BAND.map((id) => ({
    id,
    tittel: KPI_TITLER[id],
    tekst: tekst[id][0],
    under: tekst[id][1],
    status: kpiLys(tall[id], KPI_TERSKLER[id]),
  }));
}

/** The IFC-skjema tile (`skjema_tile`) off the `ifc-schema` row. */
function lesSkjema(row: ReportRow | null, schema: string): Modell["skjema"] {
  if (row?.state === "not_applicable") return { skrevet: schema || "–", verdikt: "gjelder_ikke", godtatt: "" };
  if (!row || !row.godtatte) return { skrevet: schema || "–", verdikt: "ukjent", godtatt: "" };
  const skrevet = row.fordeling?.[0]?.verdi ?? "";
  const verdikt: BlokkVerdikt =
    row.state === "pass" ? "oppfylt" : row.state === "warn" && row.fordeling?.[0]?.flagg === "" ? "kan_brukes" : "ikke_oppfylt";
  return { skrevet: skrevet || "–", verdikt, godtatt: row.godtatte.join(" · ") };
}

/** The objects the Python report counts (`n`): the physical products, read
 *  off the storey-containment row as the judged plus the scoped out. */
function antallObjekter(rows: readonly ReportRow[]): number | null {
  const d = rowOf(rows, { id: "storey-containment" })?.dekning;
  return d && d.grunnlag !== null && d.gjelder_ikke !== null ? d.grunnlag + d.gjelder_ikke : null;
}

export function beregnModell(input: ModellInput, ruleset: Ruleset | null): Modell {
  const { rows } = input;
  const label = modelLabel(input.fileName);
  const guid = lesGuid(rowOf(rows, { id: "guid-unique" }));
  const etasjer = lesEtasjer(input, ruleset, rowOf(rows, { id: "storey-config" }));
  const exempt = new Set(modelFact(ruleset, input.fileName)?.exempt ?? []);
  const blokker: Blokk[] = BLOKKER.map((def) => {
    const base = { id: def.id, tittel: def.tittel, seksjon: def.seksjon, krav_tekst: def.krav_tekst, aapne: [] };
    switch (def.id) {
      case "guid":
        return { ...base, verdikt: guid.verdikt, rad: null };
      case "etasjedefinisjon":
        return { ...base, verdikt: etasjer.verdikt, rad: null };
      case "typeobjekt":
        // Read off the product rows, so the exemption is read here: the
        // board's Typeobjekt is the element-typed row.
        return exempt.has("element-typed")
          ? { ...base, verdikt: "gjelder_ikke", rad: null }
          : { ...base, ...lesTypeobjekt(input.profile) };
      case "produkt":
      case "materiale":
        return { ...base, ...lesGren(def, rowOf(rows, { id: "material-product" })) };
      default:
        return { ...base, ...lesRad(def, rowOf(rows, KILDE[def.id]!)) };
    }
  });
  return {
    label,
    kort: label,
    fag: modelFact(ruleset, input.fileName)?.discipline ?? "",
    firma: "",
    versjon: "",
    lastet_opp: "",
    eksport: "",
    n: antallObjekter(rows),
    schema: input.summary.schema,
    kpi: lesKpi(input.profile),
    skjema: lesSkjema(rowOf(rows, { id: "ifc-schema" }), input.summary.schema),
    guid,
    etasjer,
    blokker,
  };
}

/** The round: every model whose discipline gets a report (`hoved`). */
export function beregn(inputs: readonly ModellInput[], ruleset: Ruleset | null, dato: string): Runde {
  const modeller = inputs
    .filter((m) => {
      const fag = modelFact(ruleset, m.fileName)?.discipline;
      return ruleset?.disciplines?.find((d) => d.code === fag)?.report !== false;
    })
    .map((m) => beregnModell(m, ruleset));
  return {
    prosjektNavn: ruleset ? ruleset.info?.title || ruleset.name || null : null,
    dato,
    eksport: "",
    modeller,
    guidPaaTvers: roleRule(ruleset, "copy-object") !== null,
  };
}
