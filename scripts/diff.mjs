/**
 * Compare this run's deduped events against the previous commit's
 * data/events.json (SPEC §4.2 step 7). Two jobs at once:
 *
 * 1. Carry over `first_seen_at` for events that already existed — normalize.mjs
 *    stamps every event with "now" since it has no memory of past runs; without
 *    this step, every event would look "new" on every single fetch, breaking
 *    新上架 (FR-23) entirely.
 * 2. Detect key-field changes (time/venue/status/price) for FR-34's "已更新"
 *    badge on the favorites page, and collect both into digest.json for
 *    new.html.
 */

const WATCHED_FIELDS = ["date", "time", "venue", "status", "price_min", "price_max", "on_sale_at"];

function fieldsChanged(prev, next) {
  return WATCHED_FIELDS.filter((f) => JSON.stringify(prev[f]) !== JSON.stringify(next[f]));
}

/**
 * @param {object[]} previousEvents - last run's data/events.json `events` array (may be [])
 * @param {object[]} nextEvents - this run's deduped Event[] (id already set, first_seen_at/updated_at both "now")
 * @returns {{ events: object[], digest: { generated_at: string, added_ids: string[], updated: {id:string, fields:string[]}[] } }}
 */
export function diff(previousEvents, nextEvents) {
  const prevById = new Map(previousEvents.map((e) => [e.id, e]));
  const addedIds = [];
  const updated = [];
  const now = new Date().toISOString();

  const events = nextEvents.map((event) => {
    const prev = prevById.get(event.id);

    if (!prev) {
      addedIds.push(event.id);
      return event; // first_seen_at/updated_at already "now" — genuinely new.
    }

    const changed = fieldsChanged(prev, event);
    if (changed.length > 0) {
      updated.push({ id: event.id, fields: changed });
      return { ...event, first_seen_at: prev.first_seen_at, updated_at: now, updated_fields: changed };
    }

    return { ...event, first_seen_at: prev.first_seen_at, updated_at: prev.updated_at };
  });

  return { events, digest: { generated_at: now, added_ids: addedIds, updated } };
}
