/** Number and date formatting, as `bygg_mottakskontroll.py` prints them. */

export const NBSP = " ";

export function pct(n: number, d: number): number {
  return d ? (100 * n) / d : 0;
}

/** One decimal, comma, «,0» dropped (`fmt_pct`). Python rounds half to even
 *  on the binary value; toFixed rounds the same binary value, so they agree
 *  everywhere but exact decimal ties, which a share of counts rarely is. */
export function fmtPct(p: number): string {
  const s = p.toFixed(1).replace(".", ",");
  return s.endsWith(",0") ? s.slice(0, -2) : s;
}

/** A signed whole millimetre with a space as thousands separator (`fmt_mm`). */
export function fmtMm(v: number): string {
  const r = Math.round(v);
  const s = Math.abs(r).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return (r < 0 ? "-" : "+") + s;
}

/** Millimetres as metres, comma decimal (`m_`). */
export function m_(vMm: number, dec = 2): string {
  return (vMm / 1000).toFixed(dec).replace(".", ",");
}

/** A count with a non-breaking space as thousands separator (`n_`). */
export function n_(v: number): string {
  return Math.trunc(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** A share for print, never rounded to 100 % or 0 % unless exact (`p_`). */
export function p_(p: number | null): string {
  if (p === null) return "–";
  let x = p;
  if (x >= 99.95 && x < 100) x = 99.9;
  else if (x > 0 && x < 0.05) x = 0.1;
  return `${fmtPct(x)}${NBSP}%`;
}

/** YYYY-MM-DD to DD.MM.YYYY (`dato_no`); empty stays empty. */
export function datoNo(iso: string): string {
  if (!iso) return "";
  const [aa, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${aa}`;
}

/** Zero-width space after every underscore, so a long name wraps (`brytbar`). */
export function brytbar(s: string): string {
  return s.replaceAll("_", "_​");
}

/** `html.escape(s, quote=False)`. */
export function esc(s: unknown): string {
  return String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
