/** The mottakskontroll report's HTML: the port of the `html_*` functions in
 * `mottakskontroll/bygg_mottakskontroll.py`, rendering a `Runde` (beregn.ts)
 * into the same markup, printed with the same CSS (`mottakskontroll/rapport/`).
 *
 * The model report carries the title, Nøkkeltall, Merknader and the blocks
 * (the hygiene strip only where the register configures it, which a ruleset
 * never does). The galleries after them (Typegalleri, Materialgalleri,
 * Egenskapssett, Kodelister) are not ported. The project report carries
 * Leveransen and Krav × modell; Bruk needs the register's use cases and is
 * left out as the Python report leaves it out without them.
 *
 * Pure: the CSS and the brand mark come in as text, so the selftest renders
 * from the files and the browser from its bundled copies. */

import { brytbar, datoNo, esc, fmtMm, m_, n_, p_, pct } from "./fmt.ts";
import {
  lys,
  SENTINEL,
  VERDIKT_STATUS,
  type Blokk,
  type BlokkVerdikt,
  type Etasjematrise,
  type EtasjeRad,
  type Modell,
  type Rad,
  type Runde,
  type Sted,
  type Status,
} from "./beregn.ts";
import { BLOKKER, E, SEKSJONER, TERSKEL, TERSKEL_GYLDIG, VERDIKT_ORD, type Etikett, type Terskel } from "./standard.ts";

export interface RapportAssets {
  tokens: string;
  css: string;
  /** mark-rest.svg */
  merke: string;
}

const BREDDE = 186; // mm, A4 minus 12 mm margins

const SYM: Record<Status, string> = { ok: "●", warn: "◐", bad: "○", na: "–" };

const VERDIKT_SYM: Record<Exclude<BlokkVerdikt, "ukjent">, string> = {
  oppfylt: "●",
  kan_brukes: "◐",
  ikke_oppfylt: "○",
  gjelder_ikke: "–",
  ikke_konfigurert: "∅",
};

/** `ukjent` has no symbol and no word in the Python report: the sentinel. */
function vSym(vk: BlokkVerdikt): string {
  return vk === "ukjent" ? "" : VERDIKT_SYM[vk];
}

function vOrd(vk: BlokkVerdikt): string {
  return vk === "ukjent" ? SENTINEL : VERDIKT_ORD[vk];
}

/** The square's class: `ukjent` takes the neutral grey. */
function vKlasse(vk: BlokkVerdikt): string {
  return vk === "ukjent" ? "ikke_konfigurert" : vk;
}

// The template's Nøkkeltall grid (KPI_CSS): seven cards in four columns.
const KPI_CSS = `
.mk .kpi { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.mk .kpi .flis { flex-wrap: wrap; min-width: 0; }
.mk .kpi .flis .etikett, .mk .kpi .flis .under { white-space: normal; overflow-wrap: break-word; min-width: 0; }
.mk .kpi .flis .under { margin-left: 0; flex-basis: 100%; }
`;

function sym(status: Status): string {
  return `<span class="st ${status}">${SYM[status]}</span>`;
}

/** Python's `f"{x:g}"` for the widths and tolerances printed here. */
function g(x: number): string {
  return String(Number(x.toPrecision(6)));
}

function merkeSvg(a: RapportAssets): string {
  return a.merke.trim().replace("<svg ", '<svg aria-hidden="true" ');
}

function htmlDokument(tittel: string, kropp: string, a: RapportAssets): string {
  return `<!doctype html>
<html lang="nb"><head><meta charset="utf-8"><title>${esc(tittel)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@700&display=swap" rel="stylesheet">
<style>
${a.tokens}
${a.css}
</style></head>
<body><main class="mk">
${kropp}
</main></body></html>
`;
}

function htmlHode(dato: string, over: string, tittel: string, meta: [string, string][], a: RapportAssets): string {
  const felt = meta.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("");
  return (
    `<header class="hode">${merkeSvg(a)}<div><p class="over">${esc(over)}</p>` +
    `<h1>${esc(tittel)}</h1></div><div class="dato">${esc(datoNo(dato))}</div></header>` +
    `<dl class="meta rad4">${felt}</dl>`
  );
}

function nivaaEtikett(nivaa: Sted["nivaa"]): string {
  return E(nivaa === "standard" ? "niva_standard" : "niva_prosjekt");
}

/** The location, as `<niv>sted`; a cascade the browser reads in order prints
 *  each of its sources so. */
function stedHtml(sted: Sted[]): string {
  return sted.map((s) => `<span class="niv">${esc(nivaaEtikett(s.nivaa))}</span>${esc(s.navn)}`).join(" · ");
}

function htmlLegende(): string {
  const o = VERDIKT_ORD;
  return (
    '<span class="legende">' +
    `<span>${sym("ok")} ${esc(o.oppfylt)}</span><span>${sym("warn")} ${esc(o.kan_brukes)}</span>` +
    `<span>${sym("bad")} ${esc(o.ikke_oppfylt)}</span>` +
    `<span>${sym("na")} ${esc(o.gjelder_ikke)}</span><span class="st na">∅</span><span>${esc(o.ikke_konfigurert)}</span>` +
    "</span>"
  );
}

/** One reading of one location, in the block's minimum anatomy (`html_rad`). */
function htmlRad(r: Rad, utenSted: boolean, terskler: { dekning: Terskel; gyldig: Terskel }): string {
  const ut: string[] = [];
  if (!utenSted) {
    ut.push(`<div class="rad-l"><span class="lab">${esc(E("egenskap"))}</span><span>${stedHtml(r.sted)}</span></div>`);
  }
  const t = r.tilstede;
  if (!t[1]) {
    ut.push(
      `<div class="rad-l"><span class="lab">${esc(E("dekning"))}</span><span class="tall">` +
        `${sym("na")} ${esc(VERDIKT_ORD.gjelder_ikke)} · 0 ${esc(r.grunnlag_tekst)}</span></div>`,
    );
  } else {
    // Dekning and Gyldig: two large numbers with a traffic light each,
    // «x av N» small beneath.
    const pd = pct(t[0], t[1]);
    const sd = lys(pd, terskler.dekning);
    const dekningC =
      `<div class="stort ${sd}"><span class="ssym">${SYM[sd]}</span>${esc(p_(pd))}</div>` +
      `<div class="smatt">${n_(t[0])} ${esc(E("av"))} ${n_(t[1])} ${esc(r.grunnlag_tekst)}</div>`;
    const gy = r.gyldig;
    let gyldigC: string;
    if (gy === null || !gy[1]) {
      gyldigC = '<div class="stort na"><span class="ssym">–</span></div>';
    } else {
      const pg = pct(gy[0], gy[1]);
      const sg = lys(pg, terskler.gyldig);
      gyldigC =
        `<div class="stort ${sg}"><span class="ssym">${SYM[sg]}</span>${esc(p_(pg))}</div>` +
        `<div class="smatt">${n_(gy[0])} ${esc(E("av"))} ${n_(gy[1])} ${esc(E("unike_verdier"))}</div>`;
    }
    ut.push(
      `<div class="rad-l to talrad"><span class="lab">${esc(E("dekning"))}</span><div>${dekningC}</div>` +
        `<span class="lab">${esc(E("gyldig"))}</span><div>${gyldigC}</div></div>`,
    );
  }
  ut.push(
    `<div class="rad-l"><span class="lab">${esc(E("fordeling"))}</span>` +
      `<span class="fordeling">${r.unike === null ? "–" : n_(r.unike)} ${esc(E("unike_verdier"))}</span></div>`,
  );
  return ut.join("");
}

/** The requirement row (`html_blokk`). */
function htmlBlokk(i: number, b: Blokk, terskler: Parameters<typeof htmlRad>[2]): string {
  const vk = b.verdikt;
  const kvadrat =
    `<div class="kvadrat ${vKlasse(vk)}"><span class="ksym">${vSym(vk)}</span>` +
    `<span class="kord">${esc(vOrd(vk))}</span></div>`;
  const kropp: string[] = [];
  const rad = b.rad;
  if (b.krav_tekst && rad) {
    kropp.push(
      `<div class="rad-l to"><span class="lab">${esc(E("krav"))}</span><span class="kravtekst">` +
        `${esc(b.krav_tekst)}</span><span class="lab">${esc(E("egenskap"))}</span><span>` +
        `${stedHtml(rad.sted)}</span></div>`,
    );
  } else if (b.krav_tekst) {
    kropp.push(
      `<div class="rad-l"><span class="lab">${esc(E("krav"))}</span><span class="kravtekst">` +
        `${esc(b.krav_tekst)}</span></div>`,
    );
  }
  if (vk === "ikke_konfigurert" && !rad) {
    kropp.push(
      `<div class="rad-l"><span class="lab">${esc(E("egenskap"))}</span>` +
        `<span class="st na">∅ ${esc(VERDIKT_ORD.ikke_konfigurert)}</span></div>`,
    );
  }
  if (b.bryter) {
    const br = b.bryter;
    const gruppe = E(br.gren === "telleobjekt" ? "telleobjekter" : "mengdeobjekter");
    const aapne = b.aapne.length
      ? ` · <span class="tag">${esc(E("aapen"))}</span> ` + b.aapne.map(esc).join(" · ")
      : "";
    kropp.push(
      `<div class="rad-l"><span class="lab">${esc(E("mengdetype"))}</span><span>${n_(br.antall)} ${esc(gruppe)} ` +
        `${esc(E("av"))} ${br.n === null ? "–" : n_(br.n)} ${esc(E("objekter"))}${aapne}</span></div>`,
    );
  }
  if (rad) kropp.push(htmlRad(rad, Boolean(b.krav_tekst), terskler));
  return (
    `<section class="blokk krav">${kvadrat}` +
    `<div class="navn"><span class="nr">${i}</span>${esc(b.tittel)}</div>` +
    `<div class="kropp">${kropp.join("")}</div></section>`
  );
}

/** The Kote cell's state: within tolerance ok, within twice warn, beyond bad. */
function etasjecelleKote(r: EtasjeRad, tol: Etasjematrise["toleranse"]): Status | "" {
  if (r.m_kote === null || r.k_kote === null) return "";
  const d = r.m_kote - r.k_kote;
  const grense = d > 0 ? tol.over : tol.under;
  if (grense === null || Math.abs(d) <= grense) return "ok";
  return Math.abs(d) <= 2 * grense ? "warn" : "bad";
}

/** The floors as their own component (`html_etasjekomponent`). */
function htmlEtasjekomponent(em: Etasjematrise, verdikt: BlokkVerdikt): string {
  const tol = em.toleranse;
  const rader = [...em.rader].sort((a, b) => (a.k_kote ?? a.m_kote ?? Infinity) - (b.k_kote ?? b.m_kote ?? Infinity));
  const celle = (tekst: string, st: Status | "" = "", till = "") => {
    const s = st ? `<span class="esym">${SYM[st]}</span>` : "";
    const t = till ? `<span class="etill">${esc(till)}</span>` : "";
    return `<td class="${st}">${s}${tekst}${t}</td>`;
  };
  const linjer = rader.map((r) => {
    const ref = r.k_navn
      ? celle(`${esc(r.k_navn)} <span class="ekote">${r.k_kote === null ? "" : m_(r.k_kote, 3)}</span>`)
      : celle("", "bad", E("ingen_treff"));
    let navn: string;
    let kote: string;
    if (!r.m_navn) {
      navn = celle("", "na");
      kote = celle("", "na");
    } else {
      const navnSt: Status = r.k_navn && r.m_navn.toLowerCase() !== r.k_navn.toLowerCase() ? "bad" : "ok";
      navn = celle(esc(r.m_navn), navnSt);
      const ks = etasjecelleKote(r, tol);
      const d = r.k_kote !== null && r.m_kote !== null ? r.m_kote - r.k_kote : null;
      kote = celle(r.m_kote === null ? "" : m_(r.m_kote, 3), ks, (ks === "warn" || ks === "bad") && d !== null ? `Δ ${fmtMm(d)} mm` : "");
    }
    return `<tr>${ref}${navn}${kote}</tr>`;
  });
  const grense = (x: number | null) => (x === null ? "∞" : g(x));
  const kvadrat =
    `<div class="kvadrat ${vKlasse(verdikt)}"><span class="ksym">${vSym(verdikt)}</span>` +
    `<span class="kord">${esc(vOrd(verdikt))}</span></div>`;
  return (
    `<section class="blokk krav etg-komp">${kvadrat}<div class="navn">${esc(E("etasjedefinisjon"))}</div>` +
    `<div class="kropp"><div class="etg-meta">${esc(E("kote_i_m"))} · ${esc(E("toleranse"))} +${grense(tol.over)} / ` +
    `−${grense(tol.under)} mm${em.referanse ? " · " + esc(em.referanse) : ""}</div>` +
    `<table class="etg-matrise"><colgroup><col style="width:40%"><col style="width:30%"><col></colgroup>` +
    `<thead><tr><th>${esc(E("referanse"))}</th><th>${esc(E("navn"))}</th><th>${esc(E("kote"))}</th></tr></thead>` +
    `<tbody>${linjer.join("")}</tbody></table></div></section>`
  );
}

/** The model's comment section: the register's comments are not in a
 *  ruleset, so it is the titled, ruled area where edkjo writes. */
function htmlMerknaderModell(): string {
  return '<div class="modellmerknader"><div class="linjert"></div></div>';
}

/** The GUID component: a Nøkkeltall card. Duplicates decide; GUIDs shared
 *  with other models are not measured in the browser. */
function guidKort(m: Modell): string {
  const sg = VERDIKT_STATUS[m.guid.verdikt];
  const dup = m.guid.duplikater;
  return (
    `<div class="flis ${sg}"><div class="etikett">${esc(E("duplikater_i_fila"))}</div>` +
    `<div class="verdi"><span class="ksym">${SYM[sg]}</span>${dup === null ? "–" : n_(dup)}</div>` +
    `<div class="under">${esc(E("delt_med_andre_modeller"))} –</div></div>`
  );
}

function prosjektNavn(R: Runde): string {
  return R.prosjektNavn ?? SENTINEL;
}

export function htmlModell(R: Runde, m: Modell, a: RapportAssets): string {
  const meta: [string, string][] = [
    [E("fagkode"), m.fag],
    [E("firma"), m.firma],
    [E("dalux_versjon"), m.versjon],
    [E("opplastingsdato"), datoNo(m.lastet_opp)],
    [E("eksport"), m.eksport],
  ];
  const kropp = [htmlHode(R.dato, `${prosjektNavn(R)} · ${E("rapport_navn")}`, m.label, meta, a)];
  const sk = m.skjema;
  const vk = sk.verdikt;
  kropp.push(`<h2><span class="nr">1</span>${esc(E("seksjon_nokkeltall"))}</h2><div class="kpi">`);
  for (const k of m.kpi) {
    const st = k.status;
    const s = st ? `<span class="ksym">${SYM[st]}</span>` : "";
    kropp.push(
      `<div class="flis ${st}"><div class="etikett">${esc(k.tittel)}</div>` +
        `<div class="verdi">${s}${esc(k.tekst)}</div><div class="under">${esc(k.under)}</div></div>`,
    );
  }
  const sst = VERDIKT_STATUS[vk];
  kropp.push(
    `<div class="flis ${sst}"><div class="etikett">${esc(E("ifc_skjema"))}</div>` +
      `<div class="verdi"><span class="ksym">${SYM[sst]}</span>${esc(sk.skrevet)}</div>` +
      `<div class="under"><span class="st ${sst}">${vSym(vk)} ${esc(vOrd(vk))}</span>` +
      ` · ${esc(E("godtatt"))} ${esc(sk.godtatt)}</div></div>`,
  );
  kropp.push(guidKort(m));
  kropp.push("</div>");
  kropp.push(`<h2><span class="nr">2</span>${esc(E("seksjon_merknader"))}</h2>` + htmlMerknaderModell());
  // GUID and Etasjedefinisjon are drawn as components, not repeated as
  // numbered rows.
  const komp = new Set(["guid", "etasjedefinisjon"]);
  const terskler = { dekning: TERSKEL, gyldig: TERSKEL_GYLDIG };
  let nr = 2;
  let i = 0;
  for (const s of SEKSJONER) {
    nr += 1;
    const legende = nr === 3 ? htmlLegende() : "";
    kropp.push(`<h2><span class="nr">${nr}</span>${esc(s.tittel)}${legende}</h2>`);
    if (s.id === "ifc_helse") kropp.push(htmlEtasjekomponent(m.etasjer.em, m.etasjer.verdikt));
    for (const b of m.blokker) {
      if (b.seksjon === s.id && !komp.has(b.id)) {
        i += 1;
        kropp.push(htmlBlokk(i, b, terskler));
      }
    }
  }
  // The full hash is for machines: the browser does not hash the file, so the
  // first page's bottom margin says so with «–».
  const fot =
    '<style>@page :first { @bottom-left { content: "' + E("sjekksum") + " –" +
    '"; font-family: var(--sk-skrift); font-size: var(--mk-tekst-mini); ' +
    "color: var(--sk-svak); } }</style>";
  return htmlDokument(`${E("rapport_navn")} ${m.label}`, `<style>${KPI_CSS}</style>` + fot + kropp.join("\n"), a);
}

/** Fixed label columns, then n equal model columns filling the print width. */
function colgroupMm(fast: number[], n: number): string {
  const rest = BREDDE - fast.reduce((s, x) => s + x, 0);
  const w = Math.round((rest / n) * 1000) / 1000;
  const kol = Array.from({ length: n }, () => w);
  kol[n - 1] = Math.round((rest - w * (n - 1)) * 1000) / 1000;
  return "<colgroup>" + [...fast, ...kol].map((x) => `<col style="width:${g(x)}mm">`).join("") + "</colgroup>";
}

/** The project matrix cell (`celle_blokk`): the verdict, with its coverage. */
function celleBlokk(b: Blokk): { status: Status; tekst: string; sub: string[] } {
  const vk = b.verdikt;
  const t = b.rad?.tilstede ?? null;
  const malt = t !== null && t[1] > 0;
  return {
    status: VERDIKT_STATUS[vk],
    tekst: malt ? p_(pct(t[0], t[1])) : vOrd(vk),
    sub: malt ? [vOrd(vk)] : [],
  };
}

function htmlCelle(c: { status: Status; tekst: string; sub: string[] }): string {
  const sub = c.sub.filter(Boolean).map((s) => `<span class="sub">${esc(s)}</span>`).join("");
  const tekst = c.tekst ? ` ${esc(brytbar(c.tekst))}` : "";
  return `<td class="c ${c.status}">${sym(c.status)}${tekst}${sub}</td>`;
}

export function htmlProsjekt(R: Runde, a: RapportAssets): string {
  const modeller = R.modeller;
  const hodeKol = modeller.map((m) => `<th>${esc(brytbar(m.kort))}</th>`).join("");
  const meta: [string, string][] = [
    [E("dato"), datoNo(R.dato)],
    [E("eksport"), R.eksport],
    [E("modeller"), String(modeller.length)],
  ];
  const k = [htmlHode(R.dato, E("rapport_navn"), prosjektNavn(R), meta, a)];
  const th = (e: Etikett, kl = "") => `<th${kl ? ` class="${kl}"` : ""}>${esc(E(e))}</th>`;
  // 1 Leveransen
  k.push(
    `<h2><span class="nr">1</span>${esc(E("seksjon_leveransen"))}</h2><table>` +
      "<colgroup>" + [40, 18, 36, 26, 26, 20, 20].map((w) => `<col style="width:${w}mm">`).join("") + "</colgroup>" +
      `<thead><tr>${th("modell")}${th("fagkode")}${th("firma")}` +
      `${th("dalux_versjon")}${th("opplastingsdato")}` +
      `${th("objekter_kolonne", "tall")}${th("ifc_skjema")}</tr></thead><tbody>`,
  );
  for (const m of modeller) {
    k.push(
      `<tr><td>${esc(brytbar(m.label))}</td><td>${esc(m.fag)}</td><td>${esc(m.firma)}</td>` +
        `<td>${esc(m.versjon)}</td><td>${esc(datoNo(m.lastet_opp))}</td>` +
        `<td class="tall">${m.n === null ? "–" : n_(m.n)}</td><td>${esc(m.schema)}</td></tr>`,
    );
  }
  k.push("</tbody></table>");
  // 2 Krav × modell: the blocks; a ruleset carries no requirement outside them.
  k.push(
    `<h2><span class="nr">2</span>${esc(E("seksjon_krav_modell"))}</h2><table>` + colgroupMm([34], modeller.length) +
      `<thead><tr>${th("krav")}${hodeKol}</tr></thead><tbody>`,
  );
  for (const def of BLOKKER) {
    k.push(
      `<tr><td class="krav">${esc(brytbar(def.tittel))}<small></small></td>` +
        modeller.map((m) => htmlCelle(celleBlokk(m.blokker.find((b) => b.id === def.id)!))).join("") +
        "</tr>",
    );
  }
  k.push(`</tbody></table><p>${htmlLegende()}</p>`);
  // GUID på tvers judges ownership through Kopiobjekt: with it configured the
  // Python report prints the section, and the browser does not measure it.
  if (R.guidPaaTvers) {
    k.push(`<h2><span class="nr">3</span>${esc(E("seksjon_guid_paa_tvers"))}</h2><p>${SENTINEL}</p>`);
  }
  return htmlDokument(`${E("rapport_navn")} ${E("prosjektrapport")}`, k.join("\n"), a);
}
