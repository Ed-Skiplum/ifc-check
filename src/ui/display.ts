/** Renders a check's `displayValue` — the value it FOUND — in the active
 *  language.
 *
 * The engine emits a code plus parameters rather than a sentence, exactly as
 * it does for a Finding's reason, so the same value reads Norwegian or English
 * here and stays machine-readable in the JSON an agent consumes.
 * `value.text` is the English rendering the engine already produced — used
 * only if a code arrives that this map has not caught up with, so a new check
 * never renders blank.
 *
 * Numbers go through `toLocaleString`: Norwegian writes 1 234,5 and English
 * 1,234.5, and a value built by string concatenation reads wrong in one of
 * them.
 */

import type { CheckResult, DetailLine, DisplayNoun, DisplayValue } from "../engine/types";
import type { Lang } from "./i18n";
import { locale } from "./i18n.ts";
import { formatCount } from "./format.ts";

/** Singular and plural, per language. A count of one is common enough here
 *  (one storey, one type) that "1 storeys" would show up on real files. */
const NOUNS: Record<DisplayNoun, Record<Lang, [one: string, many: string]>> = {
  products: { nb: ["produkt", "produkter"], en: ["product", "products"] },
  storeys: { nb: ["etasje", "etasjer"], en: ["storey", "storeys"] },
  types: { nb: ["type", "typer"], en: ["type", "types"] },
  stepIds: {
    nb: ["duplisert STEP-id", "dupliserte STEP-id"],
    en: ["duplicate STEP id", "duplicate STEP ids"],
  },
  levels: { nb: ["nivå", "nivåer"], en: ["level", "levels"] },
};

const OF: Record<Lang, string> = { nb: "av", en: "of" };
const UNIQUE: Record<Lang, string> = { nb: "unike", en: "unique" };
const ALL_AT: Record<Lang, string> = { nb: "alle på kote", en: "all at" };
const SHARE_ELEV: Record<Lang, string> = {
  nb: "på delt kote",
  en: "share an elevation",
};

function noun(key: string, n: number, lang: Lang): string {
  const entry = NOUNS[key as DisplayNoun];
  if (!entry) return key;
  const [one, many] = entry[lang];
  return n === 1 ? one : many;
}

export function displayText(value: DisplayValue, lang: Lang): string {
  const p = value.params;
  switch (value.code) {
    case "literal":
      return String(p.text);

    case "share":
      return `${formatCount(Number(p.good), lang)} ${OF[lang]} ${formatCount(Number(p.total), lang)}`;

    case "count": {
      const n = Number(p.n);
      return `${formatCount(n, lang)} ${noun(String(p.noun), n, lang)}`;
    }

    case "unique":
      return `${formatCount(Number(p.unique), lang)} ${UNIQUE[lang]}`;

    case "shared-elevation": {
      const total = Number(p.total);
      const shared = Number(p.shared);
      // Every storey at one elevation is the case worth naming outright: the
      // storey heights were never set. A partial collision gets the count.
      if (p.elevation !== undefined) {
        const metres = Number(p.elevation).toLocaleString(locale(lang), {
          minimumFractionDigits: 3,
          maximumFractionDigits: 3,
        });
        // The unit is omitted when the parser could not resolve it — a metre
        // suffix on an unscaled file value would be a guess (ifcfast#180).
        const unit = Number(p.resolved) === 1 ? " m" : "";
        return `${formatCount(total, lang)} ${noun("storeys", total, lang)}, ${ALL_AT[lang]} ${metres}${unit}`;
      }
      return `${formatCount(shared, lang)} ${OF[lang]} ${formatCount(total, lang)} ${SHARE_ELEV[lang]}`;
    }

    default:
      return value.text;
  }
}

/* ------------------------------------------------------------ detail line */

/** A check's detail line in the active language, from its code and params
 *  (`DetailLine`), the way `displayText` renders the found value. `fallback`
 *  is the engine's English line, used for a code this map has not caught up
 *  with. Norwegian reuses the board's own terms: the check and requirement
 *  labels, `reasons.ts`, the nouns above. */
export function detailText(detail: DetailLine, lang: Lang, fallback: string): string {
  const p = detail.params;
  const n = (key: string) => formatCount(Number(p[key]), lang);
  const nb = lang === "nb";
  const m = (key: string) =>
    Number(p[key]).toLocaleString(locale(lang), { maximumFractionDigits: 3 });
  // A metre figure the engine already fixed to its decimals (`toFixed`).
  const fixed = (key: string) => {
    const raw = String(p[key]);
    const digits = raw.includes(".") ? raw.split(".")[1].length : 0;
    return Number(raw).toLocaleString(locale(lang), {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  };
  const of = (good: string, total: string, rest: string) => `${n(good)} ${OF[lang]} ${n(total)} ${rest}`;
  switch (detail.code) {
    case "unit-scale":
      return `${p.unit}, ${nb ? "skala" : "unit scale"} ${m("scale")}`;
    case "spatial-levels":
      return `${of("good", "total", nb ? "nivåer" : "spatial levels present")} (${p.levels})`;
    case "in-storey":
      return of("good", "total", nb ? "objekter i etasje" : "elements sit in a storey");
    case "storey-in-building":
      return of("good", "total", nb ? "etasjer i bygning" : "storeys belong to a building");
    case "distinct-elevations": {
      const one = Number(p.distinct) === 1;
      return nb
        ? `${n("distinct")} ${one ? "unik kote" : "unike koter"}, ${n("total")} ${noun("storeys", Number(p.total), lang)}`
        : `${n("distinct")} distinct elevation(s) across ${n("total")} storeys`;
    }
    case "distinct-guids": {
      const one = Number(p.distinct) === 1;
      return nb
        ? `${n("distinct")} ${one ? "unik" : "unike"} GlobalId, ${n("total")} ${noun("products", Number(p.total), lang)}`
        : `${n("distinct")} distinct GlobalId across ${n("total")} products`;
    }
    case "named":
      return of("good", "total", nb ? "objekter med navn" : "elements carry a name");
    case "typed":
      return of("good", "total", nb ? "objekter med typeobjekt" : "elements linked to a type");
    case "real-type-name":
      return of("good", "total", nb ? "typede objekter med typenavn" : "typed elements have a real type name");
    case "single-instance-types":
      return of("n", "total", nb ? "typer brukt én gang" : "types used by exactly one element");
    case "types-used":
      return of("good", "total", nb ? "typeobjekter brukt" : "declared type objects are used by an element");
    case "no-type-objects":
      return nb ? "ingen typeobjekter" : "no type objects declared";
    case "with-material":
      return of("good", "total", nb ? "objekter med materiale" : "elements carry a material");
    case "placement": {
      const far = nb
        ? `${of("far", "meshed", "langt fra hovedvolumet")} (grense ${m("cutoff")} m)`
        : `${of("far", "meshed", "far from the model")} (cutoff ${m("cutoff")} m)`;
      let band: string;
      if (p.why === undefined) {
        band = nb
          ? `${n("compared")} mot etasjen: ${n("green")} grønn, ${n("yellow")} gul ` +
            `(bunn inntil ${m("tolerance")} m under, topp på eller over), ${n("red")} rød`
          : `of ${n("compared")} against their storey: ${n("green")} green, ${n("yellow")} yellow ` +
            `(bottom up to ${m("tolerance")} m below, top at or above), ${n("red")} red`;
      } else if (!nb) {
        band = String(p.note);
      } else if (p.why === "unit") {
        band = "etasjer ikke sammenlignet: lengdeenheten kunne ikke bestemmes";
      } else if (p.why === "flat") {
        band =
          `etasjer ikke sammenlignet: ${n("n")} etasjekoter kan ikke skilles` +
          (p.at === undefined ? "" : `, alle på kote ${fixed("at")} m`);
      } else if (p.why === "frames") {
        band =
          `etasjer ikke sammenlignet: bunn geometri ${fixed("bottomLo")}..${fixed("bottomHi")} m ` +
          `og etasjekoter ${fixed("elevLo")}..${fixed("elevHi")} m overlapper ikke`;
      } else {
        band = String(p.note);
      }
      const none = nb ? `${n("unmeshed")} uten geometri` : `${n("unmeshed")} without geometry`;
      return `${far}; ${band}; ${none}`;
    }
    case "storey-config":
      return nb
        ? `${of("good", "total", "etasjer stemmer med etasjeoppsettet")}; ` +
            `etasjeoppsettet har ${n("config")}, ${n("absent")} mangler i fila`
        : `${of("good", "total", "storeys match the floor config")}; ` +
            `config has ${n("config")}, ${n("absent")} absent from this file`;
    case "body-mesh": {
      const unread = Number(p.unread);
      return nb
        ? `${n("bodyNoMesh")} med Body uten mesh; ${n("meshed")} med mesh; ${n("noBody")} uten mesh og uten Body` +
            (unread ? `; ${n("unread")} ikke i STEP-fila` : "")
        : `${n("bodyNoMesh")} declare a Body representation and have no mesh; ${n("meshed")} meshed; ` +
            `${n("noBody")} without mesh declare no Body` +
            (unread ? `; ${n("unread")} not found in the STEP bytes` : "");
    }
    default:
      return fallback;
  }
}

/** A check's detail line: the coded one localised, else the engine's text. */
export function checkDetail(check: CheckResult, lang: Lang): string {
  return check.detailLine ? detailText(check.detailLine, lang, check.detail) : check.detail;
}
