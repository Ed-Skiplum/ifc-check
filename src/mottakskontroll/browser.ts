/** The browser half of the PDF export: the report CSS and brand mark bundled
 * from `mottakskontroll/rapport/`, and the print. The page prints from a
 * hidden iframe, so the browser's own «Save as PDF» writes the file, the same
 * engine Chrome prints the Python report with. */

import tokens from "../../mottakskontroll/rapport/tokens.css?raw";
import css from "../../mottakskontroll/rapport/mottakskontroll.css?raw";
import merke from "../../mottakskontroll/rapport/mark-rest.svg?raw";
import type { Runde } from "./beregn.ts";
import { htmlModell, htmlProsjekt, type RapportAssets } from "./html.ts";

const ASSETS: RapportAssets = { tokens, css, merke };

export function modellHtml(r: Runde, label: string): string {
  const m = r.modeller.find((x) => x.label === label);
  if (!m) throw new Error(`no report for ${label}`);
  return htmlModell(r, m, ASSETS);
}

export function prosjektHtml(r: Runde): string {
  return htmlProsjekt(r, ASSETS);
}

/** The frame of the last print. Kept until the next one: where print() does
 *  not block, removing it at once would cancel the dialog. */
let forrige: HTMLIFrameElement | null = null;

/** Print one report. `filnavn` becomes the suggested file name: Chrome names
 *  the PDF after the document title, so the title is set for the print and
 *  put back after. */
export async function skrivUt(html: string, filnavn: string): Promise<void> {
  forrige?.remove();
  const frame = document.createElement("iframe");
  forrige = frame;
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  const lastet = new Promise<void>((resolve) => frame.addEventListener("load", () => resolve(), { once: true }));
  frame.srcdoc = html;
  document.body.appendChild(frame);
  await lastet;
  const win = frame.contentWindow;
  const doc = frame.contentDocument;
  if (!win || !doc) throw new Error("print frame did not load");
  // The heading face is a web font: print before it lands and the PDF carries
  // the fallback.
  await doc.fonts.ready;
  const tittel = document.title;
  doc.title = filnavn;
  document.title = filnavn;
  try {
    win.print();
  } finally {
    document.title = tittel;
  }
}
