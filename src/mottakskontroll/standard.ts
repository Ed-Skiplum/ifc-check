/** The parts of `mottakskontroll/standard/standard.yaml` the report renders:
 * labels (`etiketter`), verdict words (`verdiktord`), sections, the blocks'
 * titles and requirement texts, the Nøkkeltall band and the thresholds.
 *
 * A copy, because the browser has no YAML reader. Every string here is the
 * YAML's, verbatim; the selftest reads standard.yaml and fails on drift.
 * Only the keys the browser report prints are carried. */

export const ETIKETTER = {
  seksjon_nokkeltall: "Nøkkeltall",
  seksjon_merknader: "Merknader",
  seksjon_hygiene: "Hygiene",
  objekter: "objekter",
  rapport_navn: "Mottakskontroll",
  prosjektrapport: "prosjekt",
  fagkode: "Fagkode",
  firma: "Firma",
  dalux_versjon: "Dalux-versjon",
  opplastingsdato: "Opplastingsdato",
  eksport: "Eksport",
  dato: "Dato",
  modeller: "Modeller",
  modell: "Modell",
  objekter_kolonne: "Objekter",
  niva_standard: "IFC",
  niva_prosjekt: "prosjekt",
  krav: "Krav",
  egenskap: "Egenskap",
  dekning: "Dekning",
  gyldig: "Gyldig",
  fordeling: "Fordeling",
  av: "av",
  unike_verdier: "unike verdier",
  telleobjekter: "telleobjekter",
  mengdeobjekter: "mengdeobjekter",
  aapen: "åpen",
  kote: "Kote",
  kote_i_m: "kote i m",
  toleranse: "toleranse",
  etasjedefinisjon: "Etasjedefinisjon",
  referanse: "Referanse",
  navn: "Navn",
  ingen_treff: "ingen treff",
  etasje_som_registeret: "som registeret",
  etasje_feil_navn: "feil navn",
  etasje_koteavvik: "koteavvik",
  etasje_mangler: "mangler",
  etasje_andre_nivaaer: "andre nivåer",
  etasje_ikke_konfigurert: "ikke konfigurert",
  ifc_skjema: "IFC-skjema",
  godtatt: "godtatt",
  sjekksum: "Sjekksum (SHA256)",
  duplikater_i_fila: "Duplikater i fila",
  delt_med_andre_modeller: "Delt med andre modeller",
  seksjon_leveransen: "Leveransen",
  seksjon_krav_modell: "Krav × modell",
  seksjon_guid_paa_tvers: "GUID på tvers",
} as const;

export type Etikett = keyof typeof ETIKETTER;

export function E(k: Etikett): string {
  return ETIKETTER[k];
}

export type Verdikt = "oppfylt" | "kan_brukes" | "ikke_oppfylt" | "gjelder_ikke" | "ikke_konfigurert";

export const VERDIKT_ORD: Record<Verdikt, string> = {
  oppfylt: "OK",
  kan_brukes: "Kan brukes",
  ikke_oppfylt: "Ikke oppfylt",
  gjelder_ikke: "gjelder ikke",
  ikke_konfigurert: "ikke konfigurert",
};

export const SEKSJONER = [
  { id: "ifc_helse", tittel: "IFC-struktur" },
  { id: "standardkrav", tittel: "Standardkrav" },
] as const;

export type BlokkId =
  | "typeobjekt"
  | "guid"
  | "etasjedefinisjon"
  | "etasjer"
  | "systemkode"
  | "funksjonskode"
  | "produkt"
  | "materiale"
  | "kopiobjekt"
  | "mmi"
  | "fase";

export interface BlokkDef {
  id: BlokkId;
  seksjon: (typeof SEKSJONER)[number]["id"];
  tittel: string;
  krav_tekst: string;
  /** standard.yaml declares accepted values (`har_verdiliste`): the block
   *  prints a Gyldig number. */
  verdiliste: boolean;
}

export const BLOKKER: readonly BlokkDef[] = [
  { id: "typeobjekt", seksjon: "ifc_helse", tittel: "Typeobjekt", krav_tekst: "alle IfcProduct har typeobjekt med navn", verdiliste: false },
  { id: "guid", seksjon: "ifc_helse", tittel: "GUID", krav_tekst: "ingen GlobalId to ganger i fila", verdiliste: false },
  { id: "etasjedefinisjon", seksjon: "ifc_helse", tittel: "Etasjedefinisjon", krav_tekst: "modellens etasjer er de konfigurerte, med navn og kote", verdiliste: false },
  { id: "etasjer", seksjon: "ifc_helse", tittel: "Objekter i etasje", krav_tekst: "alle objekter plassert i en etasje, med bunnen i etasjens spenn", verdiliste: false },
  { id: "systemkode", seksjon: "standardkrav", tittel: "Systemkode NS 3451", krav_tekst: "tresifret NS 3451-kode", verdiliste: true },
  { id: "funksjonskode", seksjon: "standardkrav", tittel: "Funksjonskode NS 3457-8", krav_tekst: "komponentkode fra NS 3457-8", verdiliste: true },
  { id: "produkt", seksjon: "standardkrav", tittel: "Produkt", krav_tekst: "telleobjekter har produkt", verdiliste: false },
  { id: "materiale", seksjon: "standardkrav", tittel: "Materiale", krav_tekst: "mengdeobjekter har materiale", verdiliste: true },
  { id: "kopiobjekt", seksjon: "standardkrav", tittel: "Kopiobjekt", krav_tekst: "feltet finnes, verdien er eierens fagkode", verdiliste: true },
  { id: "mmi", seksjon: "standardkrav", tittel: "MMI", krav_tekst: "feltet finnes, verdien er en prosjektkode", verdiliste: true },
  { id: "fase", seksjon: "standardkrav", tittel: "Fase", krav_tekst: "status NEW, EXISTING, DEMOLISH eller TEMPORARY", verdiliste: true },
];

export const KPI_BAND = [
  "antall_typer",
  "antall_elementer",
  "instanser_per_type_alle",
  "typer_med_en_instans_alle",
  "utypede_instanser",
] as const;

export type KpiId = (typeof KPI_BAND)[number];

export const KPI_TITLER: Record<KpiId, string> = {
  antall_typer: "Antall typer",
  antall_elementer: "Antall elementer",
  instanser_per_type_alle: "Instanser per type",
  typer_med_en_instans_alle: "Typer med én instans",
  utypede_instanser: "Utypede instanser",
};

export interface KpiTerskel {
  retning: "lav" | "hoy";
  gronn: number;
  gul: number;
}

export const KPI_TERSKLER: Partial<Record<KpiId, KpiTerskel>> = {
  typer_med_en_instans_alle: { retning: "lav", gronn: 20, gul: 40 },
  utypede_instanser: { retning: "lav", gronn: 5, gul: 20 },
  instanser_per_type_alle: { retning: "hoy", gronn: 10, gul: 3 },
};

export interface Terskel {
  ok: number;
  warn: number;
}

/** `standard.terskel` (Dekning) and `terskel_gyldig` (Gyldig). */
export const TERSKEL: Terskel = { ok: 95, warn: 5 };
export const TERSKEL_GYLDIG: Terskel = { ok: 100, warn: 95 };
