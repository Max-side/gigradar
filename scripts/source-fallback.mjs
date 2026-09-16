/**
 * SPEC §4.2 step 3: when a source fails (or silently returns 0 results) this
 * run, reuse what it contributed last time instead of contributing nothing.
 * Without this, a single blocked/broken source wipes its share of real data
 * out of events.json/needs-review.json on the very next run — this actually
 * happened once against a live GitHub Actions IP block (see HANDOFF.md's
 * "M11 的重大發現").
 */

/**
 * @param {object[]} previousEvents - last run's merged Event[] (data/events.json)
 * @param {string} sourceName
 * @returns {object[]} single-source Event-shaped objects (id/merged_ids
 *   stripped) ready to feed back into dedupe() alongside this run's freshly
 *   normalized events from other sources — dedupe() naturally re-merges them
 *   with anything a still-working source finds for the same show.
 */
export function fallbackEventsForSource(previousEvents, sourceName) {
  const fallback = [];
  for (const event of previousEvents) {
    const ownSource = event.sources.find((s) => s.name === sourceName);
    if (!ownSource) continue;
    const { id, merged_ids, sources, updated_fields, ...rest } = event;
    fallback.push({ ...rest, sources: [ownSource] });
  }
  return fallback;
}

/**
 * @param {object[]} previousReviewItems - last run's data/needs-review.json `items`
 * @param {string} sourceName
 * @returns {object[]} the subset that belonged to this source
 */
export function fallbackReviewItemsForSource(previousReviewItems, sourceName) {
  return previousReviewItems.filter((item) => item.source === sourceName);
}
