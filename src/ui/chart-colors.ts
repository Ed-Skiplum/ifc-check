/** Chart colour, one module (edkjo 2026-09-28, on the live board: *"no
 * colors in the graphs?"*). The treemaps, the MMI bars and the Graf tab's
 * class colours all read from here, so one class is one colour wherever it
 * is drawn.
 *
 *   categorical  eight calm hues off the glass field's own lights (blue,
 *                teal, sand), light enough that ink labels hold AA on every
 *                one. None is a status hue: amber (avvik), red (mangler),
 *                green (ok) and the burnt accent (selection) stay free.
 *   classes      a fixed slot for the common IFC classes, a stable hash for
 *                the rest, so IfcWall is the same colour on every model and
 *                in every drill. The 3D viewer paints the file's own colours
 *                (ifcfast `resolve_product_color`); where the file has none
 *                its fallback is a near neutral per class, and the slots
 *                follow its hue families (window blue, door and roof warm,
 *                space teal, frame members blue grey).
 *   codes        NS 3451 and NS 3457-8 by top level code (2, 3, … / A, B, …);
 *                a child is a lighter or darker step of its parent's hue.
 *   MMI          ordinal, so one blue ramp from light (low level) to deep.
 *
 * Status never owns a categorical fill: the CSS draws avvik as an amber
 * outline with a glyph and mangler as red hatching (directions.css).
 */

export type Rgb = readonly [number, number, number];

/** directions.css `--color-ink` / `--color-cream`: the two label colours. */
export const INK: Rgb = [20, 26, 34];
export const CREAM: Rgb = [247, 249, 251];

/** directions.css status and accent tokens, which no category may take. */
export const STATUS: Readonly<Record<"warn" | "fail" | "pass" | "accent", Rgb>> = {
  warn: [181, 129, 26],
  fail: [191, 59, 44],
  pass: [47, 125, 79],
  accent: [162, 72, 8],
};

export const CATEGORICAL: readonly Rgb[] = [
  [127, 163, 212], // 0 steel blue
  [108, 186, 178], // 1 teal
  [169, 146, 208], // 2 violet
  [216, 151, 184], // 3 rose
  [134, 197, 227], // 4 sky
  [143, 149, 214], // 5 indigo
  [154, 166, 184], // 6 slate
  [194, 171, 147], // 7 sand
];

/** The slot per class, by the class's bare name (no Ifc, no StandardCase). */
const CLASS_SLOT: Readonly<Record<string, number>> = {
  wall: 0,
  curtainwall: 0,
  space: 1,
  stair: 2,
  stairflight: 2,
  ramp: 2,
  rampflight: 2,
  roof: 3,
  window: 4,
  covering: 1,
  beam: 6,
  column: 6,
  member: 6,
  footing: 6,
  pile: 6,
  door: 7,
  slab: 5,
  plate: 5,
  railing: 2,
  furnishingelement: 3,
};

/** IfcWall, IFCWALL, IfcWallStandardCase → "wall". */
export function classKey(entity: string): string {
  let e = entity.trim().toLowerCase();
  if (e.startsWith("ifc")) e = e.slice(3);
  return e.replace(/(standardcase|elementedcase)$/, "");
}

function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Any label to a slot, stable across models and renders. */
export function categorical(label: string): Rgb {
  return CATEGORICAL[hash(label) % CATEGORICAL.length];
}

/** One class, one colour: the chart's and the graph's. */
export function classColour(entity: string): Rgb {
  const key = classKey(entity);
  const slot = CLASS_SLOT[key];
  return slot === undefined ? categorical(key) : CATEGORICAL[slot];
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

const WHITE: Rgb = [255, 255, 255];

/** A top level code's slot: NS 3451 digits from 2 (Bygning) on, NS 3457-8
 *  letters from A on. */
function topSlot(top: string): number {
  const c = top.toUpperCase().charCodeAt(0);
  if (c >= 48 && c <= 57) return (c - 48 + 6) % CATEGORICAL.length; // 2 → 0
  if (c >= 65 && c <= 90) return (c - 65) % CATEGORICAL.length;
  return hash(top) % CATEGORICAL.length;
}

/** A code's colour: its top level's hue, each level below a step lighter or
 *  darker by the level's own character, so siblings differ and a child stays
 *  in its parent's family. Always a fill an AA label reads on. */
export function codeColour(code: string): Rgb {
  let c = CATEGORICAL[topSlot(code.slice(0, 1) || "?")];
  for (let i = 1; i < code.length; i += 1) {
    const step = ((code.charCodeAt(i) % 4) - 1.5) * 0.12; // −0.18 … +0.18
    c = step >= 0 ? mix(c, WHITE, step + 0.06) : mix(c, INK, -step);
  }
  return readable(c);
}

/* ── contrast ─────────────────────────────────────────────────────────── */

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(c: Rgb): number {
  return 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
}

export function contrast(a: Rgb, b: Rgb): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** The ink flip, one rule for every filled cell with a label on it (the
 *  treemaps, the Etasje × klasse census): dark ink above the luminance at
 *  which the pair's two contrasts are equal, the light label below it. The
 *  threshold is computed from the pair, never tuned by eye. */
export function inkFlip(dark: Rgb = INK, light: Rgb = CREAM): number {
  return Math.sqrt((luminance(dark) + 0.05) * (luminance(light) + 0.05)) - 0.05;
}

/** The label colour for a fill: `dark` above the flip, else `light`, which
 *  is the one of the two that reads better. */
export function labelOn(fill: Rgb, dark: Rgb = INK, light: Rgb = CREAM): Rgb {
  return luminance(fill) > inkFlip(dark, light) ? dark : light;
}

/** A fill and its label at 4.5:1 or better (WCAG 2.2 AA, text under
 *  18.66 px bold). Around the flip neither label reaches 4.5 (about
 *  0.17 to 0.22 relative luminance for ink and cream), so a fill there moves
 *  out on its own side: lighter above the flip, darker below it. */
export function readableCell(fill: Rgb, dark: Rgb = INK, light: Rgb = CREAM): { fill: Rgb; ink: Rgb } {
  const above = luminance(fill) > inkFlip(dark, light);
  const toward: Rgb = above ? WHITE : dark;
  const ink = above ? dark : light;
  let out = fill;
  for (let i = 0; i < 40 && contrast(out, ink) < 4.5; i += 1) out = mix(out, toward, 0.04);
  return { fill: out, ink };
}

/** A fill in the band where neither label reaches 4.5:1 is lifted until ink
 *  does. */
function readable(c: Rgb): Rgb {
  let out = c;
  for (let i = 0; i < 20 && contrast(out, labelOn(out)) < 4.5; i += 1) out = mix(out, WHITE, 0.08);
  return out;
}

/** A frame (a code with its children drawn inside it): a pale wash of the
 *  code's hue, so the children read against it. */
export function frameColour(fill: Rgb): Rgb {
  return mix(fill, [238, 242, 246], 0.6);
}

/* ── MMI ──────────────────────────────────────────────────────────────── */

const MMI_LOW: Rgb = [170, 196, 229];
const MMI_HIGH: Rgb = [40, 78, 130];

/** Level `i` of `n` on the declared scale, low to high. */
export function mmiColour(i: number, n: number): Rgb {
  return mix(MMI_LOW, MMI_HIGH, n <= 1 ? 1 : i / (n - 1));
}

/* ── Etasje × klasse ───────────────────────────────────────────────────── */

const CENSUS_LOW: Rgb = [230, 239, 221]; // palegreen #E6EFDD
const CENSUS_HIGH: Rgb = [44, 94, 63]; // green #2C5E3F
/** The census count's two inks, #23291E and #F4EEDC. */
const CENSUS_DARK: Rgb = [35, 41, 30];
const CENSUS_LIGHT: Rgb = [244, 238, 220];

/** The ramp's share where `ok` stops (or starts) holding, by bisection:
 *  luminance falls monotonically along the ramp, so each test is a cut. */
function rampCut(ok: (share: number) => boolean, from: number, to: number): number {
  let pass = from;
  let fail = to;
  for (let i = 0; i < 40; i += 1) {
    const mid = (pass + fail) / 2;
    if (ok(mid)) pass = mid;
    else fail = mid;
  }
  return pass;
}

let censusBand: { dark: number; light: number } | null = null;

/** A census cell: its fill on the one-hue log ramp, and its count's ink by
 *  the flip rule (`labelOn`), 4.5:1 or better on every cell. It was a fixed
 *  `share > 0.55`, which set cream on mid green at 2.6 to 3.1:1 (2026-09-30
 *  review). A share in the band where neither ink reaches 4.5 moves along
 *  the ramp itself to the band's edge on its own side, so the colour stays
 *  the ramp's and more elements never read lighter. */
export function censusCell(count: number, peak: number): { fill: Rgb; ink: Rgb } {
  const at = (share: number) => mix(CENSUS_LOW, CENSUS_HIGH, share);
  const share = peak <= 1 ? 1 : Math.log1p(count) / Math.log1p(peak);
  const fill = at(share);
  const ink = labelOn(fill, CENSUS_DARK, CENSUS_LIGHT);
  if (contrast(fill, ink) >= 4.5) return { fill, ink };
  censusBand ??= {
    dark: rampCut((s) => contrast(at(s), CENSUS_DARK) >= 4.5, 0, 1),
    light: rampCut((s) => contrast(at(s), CENSUS_LIGHT) >= 4.5, 1, 0),
  };
  return ink === CENSUS_DARK
    ? { fill: at(censusBand.dark), ink: CENSUS_DARK }
    : { fill: at(censusBand.light), ink: CENSUS_LIGHT };
}

/* ── css ──────────────────────────────────────────────────────────────── */

export function css(c: Rgb): string {
  return `rgb(${c[0]} ${c[1]} ${c[2]})`;
}

/* ── the checks selftest runs ─────────────────────────────────────────── */

function hueSat(c: Rgb): { h: number; s: number } {
  const [r, g, b] = c.map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0 };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return { h: h < 0 ? h + 360 : h, s };
}

/** A category that sits on a status hue: within 25° of it and saturated
 *  enough to be read as it. */
export function clashesWithStatus(c: Rgb): string | null {
  const own = hueSat(c);
  if (own.s < 0.35) return null;
  for (const [name, status] of Object.entries(STATUS)) {
    const s = hueSat(status);
    const d = Math.abs(own.h - s.h);
    if (Math.min(d, 360 - d) < 25) return name;
  }
  return null;
}
