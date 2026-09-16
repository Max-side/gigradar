/**
 * Browser-side mirror of scripts/dedup.mjs's computeId (SPEC §4.1 / §7).
 *
 * Manual events (FR-17) never enter the backend pipeline (decision S1 — the
 * "manual" adapter always returns []), so this has to independently compute
 * the SAME id a future real scrape of the same show would get, purely so the
 * frontend can drop the manual copy once that happens (AC-17: "not shown
 * twice"). Not shared code with dedup.mjs (Node vs browser modules are kept
 * separate on purpose) — instead scripts/id-consistency.test.mjs proves the
 * two independent implementations hash identically.
 */

function normalizeForHash(s) {
  return s.trim().toLowerCase().replace(/\s+/g, "");
}

export async function computeEventId(headliner, date, venue) {
  const key = `${normalizeForHash(headliner)}|${date}|${normalizeForHash(venue)}`;
  const bytes = new TextEncoder().encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-1", bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

/**
 * Mirrors dedup.mjs's timeBucket — coarse time-of-day bucket, or null when no
 * time is known. Kept independent from dedup.mjs for the same reason as
 * computeEventId above (Node vs browser modules); id-consistency.test.mjs
 * covers this too.
 */
export function timeBucket(time) {
  if (!time) return null;
  const hour = Number(time.split(":")[0]);
  return hour < 17 ? "day" : "evening";
}

/**
 * Every id a future real scrape of this show COULD end up with: the bare id
 * dedup.mjs uses when only one time-of-day shows up for this
 * headliner/date/venue, plus the bucket-suffixed id it uses instead when a
 * matinee AND an evening show both exist that day (SPEC §4.1). A manual event
 * only knows its own time, not whether some other show will later collide
 * with it — so it must recognize either outcome as "this is now the real
 * one, drop my manual copy" (AC-17). Without this, a manually-added event
 * whose artist turns out to have both a matinee and evening show that day
 * would never match either real id and would show up as a permanent
 * duplicate — the exact gap this function closes.
 */
export async function computePossibleEventIds(headliner, date, venue, time) {
  const baseId = await computeEventId(headliner, date, venue);
  const bucket = timeBucket(time);
  return bucket ? [baseId, `${baseId}-${bucket}`] : [baseId];
}
