/**
 * The single implementation of the visibility decision tree (SPEC §6 / SRS §6.3).
 * Every page imports this instead of re-deriving visibility itself — that's what
 * keeps FR-33 (favorites always win) and FR-44 (exclude rules persist) correct
 * everywhere at once.
 *
 * Order matters and must not be reordered:
 * ended -> favorited (short-circuits everything below) -> single-event exclude
 * -> artist -> type -> keyword -> view filters (city/month/price).
 */

/**
 * @param {object} event - normalized Event (SPEC §3.1)
 * @param {object} prefs - UserPrefs (SPEC §3.3)
 * @param {object} [viewFilters] - { city?: string, month?: string, favoritesOnly?: boolean, priceMax?: number }
 * @returns {{ bucket: "ended"|"show"|"hidden"|"filtered", pinned?: boolean, reason?: string }}
 */
export function resolveVisibility(event, prefs, viewFilters = {}) {
  if (isPast(event.date)) {
    return { bucket: "ended" };
  }

  if (prefs.favorites.includes(event.id)) {
    return { bucket: "show", pinned: true };
  }

  if (prefs.excluded_events.includes(event.id)) {
    return { bucket: "hidden", reason: "event" };
  }

  const artistsToCheck = prefs.strict_mode ? event.lineup : event.headliners;
  if (artistsToCheck.some((a) => prefs.excluded_artists.includes(a))) {
    return { bucket: "hidden", reason: "artist" };
  }

  if (event.tags_type.some((t) => prefs.excluded_types.includes(t))) {
    return { bucket: "hidden", reason: "type" };
  }

  if (prefs.mute_keywords.some((kw) => event.title_raw.includes(kw))) {
    return { bucket: "hidden", reason: "keyword" };
  }

  if (!passesViewFilters(event, viewFilters)) {
    return { bucket: "filtered" };
  }

  return { bucket: "show" };
}

/** Exported so state.js's hidden-rule counters can apply the same "future only" rule. */
export function isPast(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // "T00:00:00" forces local-time parsing, matching format.js's splitDate/daysUntil —
  // a bare "YYYY-MM-DD" parses as UTC midnight instead, which for viewers at or
  // behind UTC can make a same-day event compare as already past.
  return new Date(dateStr + "T00:00:00") < today;
}

function passesViewFilters(event, viewFilters) {
  if (viewFilters.city && event.city !== viewFilters.city) return false;
  if (viewFilters.month && !event.date.startsWith(viewFilters.month)) return false;
  if (viewFilters.favoritesOnly) return false; // handled by caller pre-filtering favorites list
  if (viewFilters.priceMax != null && event.price_min != null && event.price_min > viewFilters.priceMax) {
    return false;
  }
  return true;
}

/**
 * Partition a list of events into what should render vs. what's hidden,
 * plus a count of how many are hidden by rules (for the footer bar, FR-47).
 * "filtered" (view filters) is intentionally excluded from the hidden count
 * per SRS §6.3 — only rule-based hiding counts there.
 */
export function partitionEvents(events, prefs, viewFilters = {}) {
  const visible = [];
  const ended = [];
  let hiddenByRules = 0;

  for (const event of events) {
    const result = resolveVisibility(event, prefs, viewFilters);
    if (result.bucket === "show") {
      visible.push({ event, pinned: !!result.pinned });
    } else if (result.bucket === "ended") {
      ended.push(event);
    } else if (result.bucket === "hidden") {
      hiddenByRules += 1;
    }
    // "filtered" -> not shown, not counted
  }

  return { visible, ended, hiddenByRules };
}
