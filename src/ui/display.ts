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

import type { DisplayNoun, DisplayValue } from "../engine/types";
import type { Lang } from "./i18n";
import { locale } from "./i18n";
import { formatCount } from "./format";

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
