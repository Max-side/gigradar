import crypto from "node:crypto";

/**
 * ID computation + cross-source merge (SPEC §4.1).
 */

function normalizeForHash(s) {
  return s.trim().toLowerCase().replace(/\s+/g, "");
}

export function computeId(headliner, date, venue) {
  const key = `${normalizeForHash(headliner)}|${date}|${normalizeForHash(venue)}`;
  return crypto.createHash("sha1").update(key).digest("hex").slice(0, 16);
}

const SOURCE_PRIORITY = { KKTIX: 1, "拓元": 2, "iNDIEVOX": 3, "FANSI GO": 4, "Ticket Plus": 5, manual: 6 };

/** Coarse time-of-day bucket, or null when the source didn't report a time at all. */
function timeBucket(time) {
  if (!time) return null;
  const hour = Number(time.split(":")[0]);
  return hour < 17 ? "day" : "evening";
}

function mergeGroup(group, id) {
  let result = null;
  for (const event of group) {
    if (!result) {
      result = { ...event, id, merged_ids: [id] };
      continue;
    }
    result.sources = [...result.sources, ...event.sources];
    result.lineup = Array.from(new Set([...result.lineup, ...event.lineup]));
    result.tags_type = Array.from(new Set([...result.tags_type, ...event.tags_type]));
    result.tags_origin = Array.from(new Set([...result.tags_origin, ...event.tags_origin]));
    if (event.price_min != null && (result.price_min == null || event.price_min < result.price_min)) {
      result.price_min = event.price_min;
    }
    if (event.price_max != null && (result.price_max == null || event.price_max > result.price_max)) {
      result.price_max = event.price_max;
    }
    const existingPriority = Math.min(...result.sources.map((s) => SOURCE_PRIORITY[s.name] ?? 99));
    const newPriority = SOURCE_PRIORITY[event.sources[0]?.name] ?? 99;
    if (newPriority < existingPriority) {
      result.ticket_url = event.ticket_url;
    }
  }
  return result;
}

/**
 * @param {object[]} events - Event-shaped objects (no id yet), each already
 *   carrying a single-element `sources` array from whichever adapter found it.
 * @returns {object[]} deduped Event[] with id/merged_ids/sources/ticket_url set.
 */
export function dedupe(events) {
  const groups = new Map(); // baseId (headliner+date+venue) -> raw event[]

  for (const event of events) {
    const baseId = computeId(event.headliners[0] ?? event.title_raw, event.date, event.venue);
    if (!groups.has(baseId)) groups.set(baseId, []);
    groups.get(baseId).push(event);
  }

  const results = [];
  for (const [baseId, group] of groups) {
    const nonNullBuckets = [...new Set(group.map((e) => timeBucket(e.time)).filter(Boolean))];

    if (nonNullBuckets.length <= 1) {
      // Same headliner/date/venue and no conflicting time-of-day info — this
      // is one show, possibly reported with a missing/imprecise time by one
      // source (e.g. 拓元 never gives a time at all). Safe to merge.
      results.push(mergeGroup(group, baseId));
      continue;
    }

    // Two+ distinct time-of-day buckets under the same headliner/date/venue —
    // a matinee + evening show, not one event (SPEC §4.1 / dedup.test.mjs).
    // A time-less entry can't be placed with certainty here; it's folded into
    // whichever bucket appears first, a documented simplification for this
    // rare (3-shows-same-day) case rather than guessing further.
    const byBucket = new Map();
    for (const event of group) {
      const bucket = timeBucket(event.time) ?? nonNullBuckets[0];
      if (!byBucket.has(bucket)) byBucket.set(bucket, []);
      byBucket.get(bucket).push(event);
    }
    for (const [bucket, bucketGroup] of byBucket) {
      results.push(mergeGroup(bucketGroup, `${baseId}-${bucket}`));
    }
  }

  return results;
}
