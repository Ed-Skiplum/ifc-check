/** Squarified treemap layout (Bruls, Huizing & van Wijk 2000): rectangles
 *  whose areas are proportional to `n`, laid in rows along the shorter side so
 *  the cells stay as near square as the values allow. Pure; the chart draws
 *  what this returns. */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function worst(row: number[], side: number, scale: number): number {
  const sum = row.reduce((a, b) => a + b, 0) * scale;
  if (sum <= 0) return Infinity;
  let max = 0;
  for (const v of row) {
    const area = v * scale;
    const r = Math.max((side * side * area) / (sum * sum), (sum * sum) / (side * side * area));
    max = Math.max(max, r);
  }
  return max;
}

/** One rectangle per value, in the order given (largest first reads best). */
export function squarify(values: readonly number[], box: Rect): Rect[] {
  const out: Rect[] = values.map(() => ({ x: box.x, y: box.y, w: 0, h: 0 }));
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0 || box.w <= 0 || box.h <= 0) return out;
  const scale = (box.w * box.h) / total;
  let { x, y, w, h } = box;
  let i = 0;
  while (i < values.length) {
    const side = Math.min(w, h);
    const row: number[] = [values[i]];
    let j = i + 1;
    while (j < values.length && worst([...row, values[j]], side, scale) <= worst(row, side, scale)) {
      row.push(values[j]);
      j += 1;
    }
    const rowArea = row.reduce((a, b) => a + b, 0) * scale;
    if (w >= h) {
      // A column at the left, as wide as its area over the height.
      const cw = h > 0 ? rowArea / h : 0;
      let cy = y;
      row.forEach((v, k) => {
        const ch = cw > 0 ? (v * scale) / cw : 0;
        out[i + k] = { x, y: cy, w: cw, h: ch };
        cy += ch;
      });
      x += cw;
      w -= cw;
    } else {
      const rh = w > 0 ? rowArea / w : 0;
      let cx = x;
      row.forEach((v, k) => {
        const cw = rh > 0 ? (v * scale) / rh : 0;
        out[i + k] = { x: cx, y, w: cw, h: rh };
        cx += cw;
      });
      y += rh;
      h -= rh;
    }
    i = j;
  }
  return out;
}
