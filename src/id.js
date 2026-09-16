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
