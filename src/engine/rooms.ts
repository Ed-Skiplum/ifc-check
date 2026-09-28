/** The Rom tab's data (edkjo 2026-09-28: *"spaces should be kept separate
 *  from the treemap … add a tab for spaces … Spacial with an aggregated
 *  room/space schedule"*).
 *
 * Pure. Two halves, each with a selftest in `scripts/ids-cli.ts`:
 *
 *   names      `spaceLongNames` reads every IfcSpace's LongName out of the
 *              STEP bytes, chunked, the way `quantityUnits` reads the units.
 *              No wasm accessor gives LongName, and it is where the room's
 *              function lives: on HI90_ARK every IfcSpace.Name is '' and
 *              LongName carries «Kiwi», «WC», «Møterom». An ifczip has no
 *              readable STEP bytes, so its LongNames stay unread and the
 *              schedule says so.
 *
 *   schedule   `roomSchedule` groups the spaces by room name (LongName, else
 *              Name) or by storey, and sums area and volume per group from
 *              the resolved element quantities (`quantities.ts`: the
 *              BaseQuantities first, the closed-mesh estimate second). A
 *              group's sum counts only rooms that have the value; the ones
 *              still pending or missing are counted beside it, never as 0.
 */

import { argsFrom, type ElementQuantity } from "./quantities.ts";

/* ── LongName from the STEP bytes ─────────────────────────────────────── */

const SPACE = /#(\d+)\s*=\s*IFCSPACE\s*\(/gi;

/** Top-level arguments of a STEP statement's argument text, quote- and
 *  paren-aware. */
export function splitArgs(args: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < args.length; i += 1) {
    const c = args.charCodeAt(i);
    if (quoted) {
      if (c === 39) {
        if (args.charCodeAt(i + 1) === 39) i += 1;
        else quoted = false;
      }
    } else if (c === 39) quoted = true;
    else if (c === 40) depth += 1;
    else if (c === 41) depth -= 1;
    else if (c === 44 && depth === 0) {
      out.push(args.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(args.slice(start).trim());
  return out;
}

/** A STEP string's content (ISO 10303-21 §7.3.3): `''`, `\\`, `\S\`,
 *  `\X\hh`, `\X2\…\X0\` and `\X4\…\X0\`; `\P?\` code page switches are
 *  dropped. Bytes an exporter wrote as raw UTF-8 (not the standard, but
 *  common) arrive here as latin1 pairs and are read back as UTF-8 when they
 *  form valid UTF-8. */
export function decodeStepString(raw: string): string {
  let text = raw;
  if (/[\u0080-ÿ]/.test(text)) {
    const bytes = Uint8Array.from(text, (ch) => ch.charCodeAt(0) & 0xff);
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      // Not UTF-8: the latin1 reading stands.
    }
  }
  let out = "";
  for (let i = 0; i < text.length; ) {
    const c = text[i];
    if (c === "'" && text[i + 1] === "'") {
      out += "'";
      i += 2;
    } else if (c === "\\") {
      if (text[i + 1] === "\\") {
        out += "\\";
        i += 2;
      } else if (text.startsWith("\\X2\\", i) || text.startsWith("\\X4\\", i)) {
        const width = text[i + 2] === "2" ? 4 : 8;
        const end = text.indexOf("\\X0\\", i + 4);
        const hex = text.slice(i + 4, end < 0 ? text.length : end);
        for (let k = 0; k + width <= hex.length; k += width) {
          const code = parseInt(hex.slice(k, k + width), 16);
          if (Number.isFinite(code)) out += width === 4 ? String.fromCharCode(code) : String.fromCodePoint(code);
        }
        i = end < 0 ? text.length : end + 4;
      } else if (text.startsWith("\\X\\", i)) {
        const code = parseInt(text.slice(i + 3, i + 5), 16);
        if (Number.isFinite(code)) out += String.fromCharCode(code);
        i += 5;
      } else if (text.startsWith("\\S\\", i)) {
        out += String.fromCharCode(text.charCodeAt(i + 3) + 128);
        i += 4;
      } else if (/^\\P[A-I]\\/.test(text.slice(i, i + 4))) {
        i += 4;
      } else {
        out += c;
        i += 1;
      }
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

/** A STEP string attribute (`'…'`) decoded, or null for `$`, `*` and ''. */
export function stepText(arg: string | undefined): string | null {
  if (!arg || arg[0] !== "'" || arg[arg.length - 1] !== "'") return null;
  const text = decodeStepString(arg.slice(1, -1)).trim();
  return text === "" ? null : text;
}

/** Every IfcSpace's LongName by GlobalId, read from the STEP bytes in
 *  chunks. LongName is the 8th attribute in IFC2X3 and IFC4 alike. A space
 *  with no LongName is in the map as null, so "read, none" and "not read"
 *  stay two answers. */
export function spaceLongNames(bytes: Uint8Array, chunk = 8 << 20): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const decoder = new TextDecoder("latin1");
  let carry = "";
  for (let at = 0; at < bytes.length; at += chunk) {
    const text = carry + decoder.decode(bytes.subarray(at, Math.min(bytes.length, at + chunk)));
    const last = at + chunk >= bytes.length;
    SPACE.lastIndex = 0;
    let keepFrom = last ? text.length : Math.max(0, text.lastIndexOf(";") + 1);
    for (let m = SPACE.exec(text); m; m = SPACE.exec(text)) {
      if (!last && m.index >= keepFrom) break;
      const body = argsFrom(text, m.index + m[0].length);
      if (!body) {
        if (!last) keepFrom = Math.min(keepFrom, m.index);
        break;
      }
      SPACE.lastIndex = body.end;
      const parts = splitArgs(body.args);
      const guid = stepText(parts[0]);
      if (guid) out[guid] = stepText(parts[7]);
    }
    carry = last ? "" : text.slice(keepFrom);
  }
  return out;
}

/* ── the schedule ─────────────────────────────────────────────────────── */

export interface RoomRow {
  guid: string;
  /** IfcSpace.Name (often the room number). */
  name: string | null;
  /** IfcSpace.LongName (often the room's function); undefined when not read. */
  longName?: string | null;
  storeyGuid: string | null;
}

export interface StoreyRef {
  guid: string;
  name: string | null;
  elevation: number | null;
}

export type RoomGrouping = "name" | "storey";

/** One summed quantity: the sum over the rooms that have it, and how many
 *  rooms do not have it yet (`pending`) or at all (`missing`). */
export interface RoomSum {
  value: number;
  /** Rooms whose value is the BaseQuantity, and the computed estimate. */
  qto: number;
  computed: number;
  missing: number;
  pending: number;
}

export interface RoomGroup {
  /** Unique within the grouping: `name:<label>` or `storey:<guid>`. */
  key: string;
  /** The room name or the storey name; null for no name, no storey. */
  label: string | null;
  guids: string[];
  area: RoomSum;
  volume: RoomSum;
}

/** What the schedule prints for a room: LongName, else Name. */
export function roomLabel(row: RoomRow): string | null {
  const long = row.longName?.trim();
  if (long) return long;
  const name = row.name?.trim();
  return name ? name : null;
}

const emptySum = (): RoomSum => ({ value: 0, qto: 0, computed: 0, missing: 0, pending: 0 });

/** Add one room's resolved value (`ElementQuantity` source: 0 Qto, 1
 *  computed, 2 missing, 3 pending). No entry at all is pending: the
 *  quantities have not arrived. */
export function addTo(sum: RoomSum, value: number | null | undefined, source: 0 | 1 | 2 | 3 | undefined): void {
  if (source === undefined) sum.pending += 1;
  else if (source === 3) sum.pending += 1;
  else if (source === 2 || value === null || value === undefined) sum.missing += 1;
  else {
    sum.value += value;
    if (source === 0) sum.qto += 1;
    else sum.computed += 1;
  }
}

/** The spaces grouped by room name or by storey, each group's area and
 *  volume summed. Name groups by count, largest first, the unnamed last;
 *  storey groups top floor first, no storey last. */
export function roomSchedule(
  rooms: readonly RoomRow[],
  grouping: RoomGrouping,
  quantities: Readonly<Record<string, ElementQuantity>> | undefined,
  storeys: readonly StoreyRef[],
): RoomGroup[] {
  const groups = new Map<string, RoomGroup>();
  const storeyOf = new Map(storeys.map((s) => [s.guid, s]));
  for (const room of rooms) {
    let key: string;
    let label: string | null;
    if (grouping === "name") {
      label = roomLabel(room);
      key = `name:${label ?? ""}`;
    } else {
      label = room.storeyGuid ? (storeyOf.get(room.storeyGuid)?.name ?? room.storeyGuid) : null;
      key = `storey:${room.storeyGuid ?? ""}`;
    }
    let group = groups.get(key);
    if (!group) {
      group = { key, label, guids: [], area: emptySum(), volume: emptySum() };
      groups.set(key, group);
    }
    group.guids.push(room.guid);
    const q = quantities?.[room.guid];
    addTo(group.volume, q?.[0], q?.[1]);
    addTo(group.area, q?.[2], q?.[3]);
  }
  const list = [...groups.values()];
  if (grouping === "name") {
    return list.sort(
      (a, b) =>
        (a.label === null ? 1 : 0) - (b.label === null ? 1 : 0) ||
        b.guids.length - a.guids.length ||
        String(a.label).localeCompare(String(b.label)),
    );
  }
  const elevation = (g: RoomGroup) => {
    const guid = g.key.slice("storey:".length);
    return guid ? (storeyOf.get(guid)?.elevation ?? -Infinity) : null;
  };
  return list.sort((a, b) => {
    const ea = elevation(a);
    const eb = elevation(b);
    if (ea === null || eb === null) return (ea === null ? 1 : 0) - (eb === null ? 1 : 0);
    return eb - ea || String(a.label).localeCompare(String(b.label));
  });
}

/** Sum of several groups' sums (the schedule's total line). */
export function totalOf(groups: readonly RoomGroup[], pick: (g: RoomGroup) => RoomSum): RoomSum {
  const out = emptySum();
  for (const g of groups) {
    const s = pick(g);
    out.value += s.value;
    out.qto += s.qto;
    out.computed += s.computed;
    out.missing += s.missing;
    out.pending += s.pending;
  }
  return out;
}
