/** Which BCF topics an export produces, and what each one carries.
 *
 * Pure: no DOM, no three.js, no i18n. The caller hands in the failing checks
 * already rendered in its language, the storey of every element, and
 * (optionally) a space lookup; this module decides the grouping, the split and
 * the identity. The browser export and `scripts/bcf-cli.ts` both run it.
 *
 * ── Granularity ─────────────────────────────────────────────────────────
 *   one group per  model × failing check × storey
 *   a group over `maxGuids` is split by SPACE when a space lookup exists:
 *   one bucket per room for the DISCRETE elements in it, and one storey
 *   bucket for everything else (walls, slabs and other massing, and anything
 *   in no room); any bucket still over `maxGuids` is cut into numbered parts.
 *
 * The space lookup answers only for discrete objects (see `spaces.ts`), so
 * there is no "no space" bucket: an element that is not a room's discrete
 * object is the storey's, and its topic is titled with the storey alone.
 *
 * The storey is the element's STATED containing storey (the graph's
 * `storey_guid`), never a geometric guess. A finding whose GlobalId is itself a
 * storey (storey-elevation, storey-config) belongs to that storey. Elements
 * with no storey form their own group, ordered last.
 *
 * A failing check with no usable GlobalId at all (a parse-level finding, a
 * missing spatial level) is still a topic: one, with no components.
 *
 * ── Identity ────────────────────────────────────────────────────────────
 * Topic GUIDs are uuid v5 over (model cache_key, check key, storey GlobalId,
 * space GlobalId or "-", part), so re-exporting the same model gives the same
 * GUIDs and a CDE can match the topics to the ones it already holds. The
 * storey bucket seeds like an unsplit group, so a storey's first topic keeps
 * its GUID when the group grows past `maxGuids`.
 */

import { uuidV5 } from "./uuid.ts";

/** Fixed namespace for every GUID this module mints. Changing it changes every
 *  topic GUID ever exported, so it never changes. */
export const BCF_NAMESPACE = "6f1c3f0e-5b1a-4a8e-9f4e-2d7b9c0a1e53";

const IFC_GUID = /^[0-9A-Za-z_$]{22}$/;

export function isIfcGuid(value: string): boolean {
  return IFC_GUID.test(value);
}

/** One element a failing check names, with the reason in the caller's
 *  language. A type finding is expanded to its member elements by the caller. */
export interface BcfFinding {
  guid: string;
  reason: string;
}

/** One failing check or rule on one model. */
export interface BcfCheck {
  /** Stable key: `fundamental:<id>` or `rule:<ruleId>`. Seeds the GUID. */
  key: string;
  label: string;
  /** Lines that open every topic's description: the value found, the detail
   *  line. Existing strings, rendered by the caller. */
  head: string[];
  findings: BcfFinding[];
}

export interface BcfStorey {
  guid: string;
  name: string;
  /** Metres, after unit_scale. null when the file has none. */
  elevation: number | null;
}

export interface BcfSpace {
  guid: string;
  name: string;
}

export interface BcfModelPlanInput {
  fileName: string;
  cacheKey: string;
  checks: BcfCheck[];
  storeys: BcfStorey[];
  /** Element GlobalId -> stated storey GlobalId (null = none). */
  storeyOf: Map<string, string | null>;
  /** Element GlobalId -> the space it is a DISCRETE object of, or null
   *  (massing, or in no space). Absent when no space-bearing model is
   *  available: the split falls back to parts. */
  spaceOf?: (guid: string) => BcfSpace | null;
}

export interface BcfStrings {
  noStorey: string;
}

export type SplitPath = "single" | "space" | "parts" | "space+parts";

export interface TopicPlan {
  guid: string;
  viewpointGuid: string;
  model: number;
  fileName: string;
  checkKey: string;
  title: string;
  description: string;
  labels: string[];
  /** The chunk's element GlobalIds, deduplicated, <= maxGuids. */
  guids: string[];
  storeyGuid: string | null;
  spaceGuid: string | null;
  part: number;
  parts: number;
  index: number;
}

/** One model × check × storey group and how it was cut. */
export interface GroupReport {
  fileName: string;
  checkKey: string;
  storey: string;
  elements: number;
  /** Elements that went to room buckets (the rest are the storey's). */
  inRooms: number;
  path: SplitPath;
  topics: number;
}

export interface BcfPlan {
  topics: TopicPlan[];
  groups: GroupReport[];
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out.length > 0 ? out : [[]];
}

/** Reason lines for one chunk: each distinct reason once, with its count when
 *  more than one element carries it. */
function reasonLines(guids: string[], reasons: Map<string, string[]>): string[] {
  const counts = new Map<string, number>();
  for (const guid of guids) {
    for (const reason of reasons.get(guid) ?? []) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts].map(([reason, n]) => (n > 1 ? `${reason} (${n})` : reason));
}

export function planTopics(
  models: BcfModelPlanInput[],
  maxGuids: number,
  strings: BcfStrings,
): BcfPlan {
  const size = Math.max(1, Math.floor(maxGuids));
  const topics: TopicPlan[] = [];
  const groups: GroupReport[] = [];

  models.forEach((model, modelIndex) => {
    const storeyByGuid = new Map(model.storeys.map((s) => [s.guid, s]));
    // Storey order: by elevation, unknown elevations after known ones, and the
    // no-storey group last.
    const storeyRank = new Map<string | null, number>();
    [...model.storeys]
      .map((s, i) => ({ s, i }))
      .sort((a, b) => {
        const ea = a.s.elevation;
        const eb = b.s.elevation;
        if (ea === null && eb === null) return a.i - b.i;
        if (ea === null) return 1;
        if (eb === null) return -1;
        return ea - eb || a.i - b.i;
      })
      .forEach(({ s }, rank) => storeyRank.set(s.guid, rank));
    storeyRank.set(null, model.storeys.length);

    const modelTopics: (Omit<TopicPlan, "index"> & { rank: number; checkOrder: number })[] = [];

    model.checks.forEach((check, checkOrder) => {
      const reasons = new Map<string, string[]>();
      const valid: string[] = [];
      for (const finding of check.findings) {
        if (!isIfcGuid(finding.guid)) continue;
        const list = reasons.get(finding.guid);
        if (list) {
          if (!list.includes(finding.reason)) list.push(finding.reason);
          continue;
        }
        reasons.set(finding.guid, [finding.reason]);
        valid.push(finding.guid);
      }

      const make = (
        guids: string[],
        storeyGuid: string | null,
        storeyLabel: string | null,
        space: BcfSpace | null,
        part: number,
        parts: number,
      ) => {
        const seed = [
          model.cacheKey,
          check.key,
          storeyGuid ?? "no-storey",
          space ? space.guid : "-",
          String(part),
        ].join("|");
        const guid = uuidV5(seed, BCF_NAMESPACE);
        const spaceLabel = space ? space.name : null;
        const titleParts = [check.label];
        if (storeyLabel !== null) titleParts.push(storeyLabel);
        if (spaceLabel !== null) titleParts.push(spaceLabel);
        const title = titleParts.join(" · ") + (parts > 1 ? ` (${part}/${parts})` : "");
        const labels: string[] = [];
        if (storeyLabel !== null) labels.push(storeyLabel);
        if (spaceLabel !== null) labels.push(spaceLabel);
        modelTopics.push({
          guid,
          viewpointGuid: uuidV5(`${guid}|viewpoint`, BCF_NAMESPACE),
          model: modelIndex,
          fileName: model.fileName,
          checkKey: check.key,
          title,
          description: [...check.head, ...reasonLines(guids, reasons)].join("\n"),
          labels,
          guids,
          storeyGuid,
          spaceGuid: space?.guid ?? null,
          part,
          parts,
          rank: storeyRank.get(storeyGuid) ?? model.storeys.length,
          checkOrder,
        });
      };

      if (valid.length === 0) {
        // Failing, but nothing addressable: one topic, no components.
        make([], null, null, null, 1, 1);
        groups.push({
          fileName: model.fileName,
          checkKey: check.key,
          storey: "-",
          elements: 0,
          inRooms: 0,
          path: "single",
          topics: 1,
        });
        return;
      }

      // Bucket by stated storey. A GlobalId that IS a storey is its own.
      const byStorey = new Map<string | null, string[]>();
      for (const guid of valid) {
        const storey = storeyByGuid.has(guid) ? guid : (model.storeyOf.get(guid) ?? null);
        const key = storey !== null && storeyByGuid.has(storey) ? storey : null;
        const list = byStorey.get(key);
        if (list) list.push(guid);
        else byStorey.set(key, [guid]);
      }

      for (const [storeyGuid, guids] of byStorey) {
        const storeyLabel =
          storeyGuid === null
            ? strings.noStorey
            : storeyByGuid.get(storeyGuid)!.name || storeyGuid;
        const before = modelTopics.length;
        let path: SplitPath;
        let inRooms = 0;

        if (guids.length <= size) {
          make(guids, storeyGuid, storeyLabel, null, 1, 1);
          path = "single";
        } else if (model.spaceOf) {
          const bySpace = new Map<string | null, { space: BcfSpace | null; guids: string[] }>();
          for (const guid of guids) {
            const space = model.spaceOf(guid);
            const key = space?.guid ?? null;
            const bucket = bySpace.get(key);
            if (bucket) bucket.guids.push(guid);
            else bySpace.set(key, { space, guids: [guid] });
          }
          // The storey bucket first, then rooms by name.
          const buckets = [...bySpace.values()].sort((a, b) => {
            if (!a.space) return -1;
            if (!b.space) return 1;
            return a.space.name.localeCompare(b.space.name, undefined, { numeric: true });
          });
          let cut = false;
          for (const bucket of buckets) {
            if (bucket.space) inRooms += bucket.guids.length;
            const pieces = chunk(bucket.guids, size);
            if (pieces.length > 1) cut = true;
            pieces.forEach((piece, i) =>
              make(piece, storeyGuid, storeyLabel, bucket.space, i + 1, pieces.length),
            );
          }
          path = inRooms === 0 ? "parts" : cut ? "space+parts" : "space";
        } else {
          const pieces = chunk(guids, size);
          pieces.forEach((piece, i) =>
            make(piece, storeyGuid, storeyLabel, null, i + 1, pieces.length),
          );
          path = "parts";
        }

        groups.push({
          fileName: model.fileName,
          checkKey: check.key,
          storey: storeyLabel,
          elements: guids.length,
          inRooms,
          path,
          topics: modelTopics.length - before,
        });
      }
    });

    // Floor first (by elevation, no-storey last), then check, then the order
    // the topics were made in (storey bucket, space name, part).
    modelTopics
      .map((topic, made) => ({ topic, made }))
      .sort(
        (a, b) =>
          a.topic.rank - b.topic.rank ||
          a.topic.checkOrder - b.topic.checkOrder ||
          a.made - b.made,
      )
      .forEach(({ topic }) => {
        const { rank: _rank, checkOrder: _checkOrder, ...plain } = topic;
        void _rank;
        void _checkOrder;
        topics.push({ ...plain, index: topics.length + 1 });
      });
  });

  return { topics, groups };
}
