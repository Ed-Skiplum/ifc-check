/** Number and size formatting, locale-aware.
 *
 * Norwegian writes 1 234,5 and English 1,234.5; the same figures must read
 * right in both, so nothing here builds a number by string concatenation.
 */

import type { Lang } from "./i18n";
import { locale } from "./i18n";

export function formatBytes(bytes: number, lang: Lang): string {
  const l = locale(lang);
  if (bytes >= 1e9) return `${(bytes / 1e9).toLocaleString(l, { maximumFractionDigits: 2 })} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toLocaleString(l, { maximumFractionDigits: 1 })} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toLocaleString(l, { maximumFractionDigits: 0 })} kB`;
  return `${bytes.toLocaleString(l)} B`;
}

export function formatCount(value: number, lang: Lang): string {
  return value.toLocaleString(locale(lang));
}

export function formatMs(ms: number, lang: Lang): string {
  return `${Math.round(ms).toLocaleString(locale(lang))} ms`;
}

/** A share as a whole percent. Zero applicable gives an em dash, never 0 %. */
export function formatShare(part: number, total: number, lang: Lang): string {
  if (total <= 0) return "—";
  return (part / total).toLocaleString(locale(lang), {
    style: "percent",
    maximumFractionDigits: 0,
  });
}

/** Storey elevation.
 *
 * ifcfast reports it in FILE units while geometry is metres (ifcfast#180), so
 * it is scaled here. When the parser could not resolve the unit the raw value
 * is shown with no unit suffix rather than a metre figure that would be a
 * guess.
 */
export function formatElevation(
  elevation: number | null,
  unitScale: number,
  unitResolved: boolean,
  lang: Lang,
): string {
  if (elevation === null) return "—";
  const l = locale(lang);
  if (!unitResolved) {
    return elevation.toLocaleString(l, { maximumFractionDigits: 3 });
  }
  return `${(elevation * unitScale).toLocaleString(l, {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  })} m`;
}
