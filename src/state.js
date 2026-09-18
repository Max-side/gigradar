/**
 * UserPrefs persistence (SPEC §3.3, §8).
 * M1: localStorage read/write only. Gist sync (M9) plugs into syncToGist/syncFromGist below.
 */

import { computeEventId, computePossibleEventIds } from "./id.js";
import { isPast } from "./filter.js";

const STORAGE_KEY = "gigradar:prefs";

export function defaultPrefs() {
  return {
    favorites: [],
    excluded_events: [],
    excluded_artists: [],
    excluded_types: [],
    excluded_venues: [],
    mute_keywords: [],
    strict_mode: false,
    last_backup_at: null,
    gist_id: null,
    updated_at: new Date().toISOString(),
  };
}

export function loadPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultPrefs();
    return { ...defaultPrefs(), ...JSON.parse(raw) };
  } catch {
    // Corrupt localStorage should never wipe the user out — fall back, don't throw.
    return defaultPrefs();
  }
}

function persistPrefs(next) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function savePrefs(prefs) {
  const next = persistPrefs({ ...prefs, updated_at: new Date().toISOString() });
  scheduleGistSync(next);
  return next;
}

// --- Favorites (US-06/07, FR-31) ---------------------------------------

export function isFavorited(prefs, eventId) {
  return prefs.favorites.includes(eventId);
}

export function toggleFavorite(eventId) {
  const prefs = loadPrefs();
  const idx = prefs.favorites.indexOf(eventId);
  if (idx === -1) prefs.favorites.push(eventId);
  else prefs.favorites.splice(idx, 1);
  return savePrefs(prefs);
}

// --- Exclude rules (US-09/10/11, FR-41~44) ------------------------------
// Each rule list holds plain values (event id / canonical artist name / tag
// string). Adding is idempotent; removing just filters it out — this is what
// makes "解除規則後立即恢復" (AC-44) work without waiting for next fetch,
// since filter.js re-evaluates every event against the CURRENT prefs on every
// render, it never caches a "hidden" verdict per event.

function addUnique(list, value) {
  return list.includes(value) ? list : [...list, value];
}
function removeValue(list, value) {
  return list.filter((v) => v !== value);
}

export function excludeEvent(eventId) {
  const prefs = loadPrefs();
  prefs.excluded_events = addUnique(prefs.excluded_events, eventId);
  return savePrefs(prefs);
}
export function unexcludeEvent(eventId) {
  const prefs = loadPrefs();
  prefs.excluded_events = removeValue(prefs.excluded_events, eventId);
  return savePrefs(prefs);
}

export function excludeArtist(name) {
  const prefs = loadPrefs();
  prefs.excluded_artists = addUnique(prefs.excluded_artists, name);
  return savePrefs(prefs);
}
export function unexcludeArtist(name) {
  const prefs = loadPrefs();
  prefs.excluded_artists = removeValue(prefs.excluded_artists, name);
  return savePrefs(prefs);
}

export function excludeType(tag) {
  const prefs = loadPrefs();
  prefs.excluded_types = addUnique(prefs.excluded_types, tag);
  return savePrefs(prefs);
}
export function unexcludeType(tag) {
  const prefs = loadPrefs();
  prefs.excluded_types = removeValue(prefs.excluded_types, tag);
  return savePrefs(prefs);
}

/** FR-48: how many of the user's already-favorited events would this artist-block affect? */
export function countFavoritedByArtist(artistName, events, prefs) {
  return events.filter(
    (e) => prefs.favorites.includes(e.id) && (e.headliners.includes(artistName) || e.lineup.includes(artistName))
  ).length;
}

/** For 已隱藏管理 (FR-46): how many currently-visible-if-not-excluded future events each rule hides. */
export function countHiddenByArtist(artistName, events, prefs) {
  return events.filter(
    (e) =>
      !isPast(e.date) &&
      !prefs.favorites.includes(e.id) &&
      (prefs.strict_mode ? e.lineup.includes(artistName) : e.headliners.includes(artistName))
  ).length;
}
export function countHiddenByType(tag, events, prefs) {
  return events.filter((e) => !isPast(e.date) && !prefs.favorites.includes(e.id) && e.tags_type.includes(tag)).length;
}

// --- Manual events (US-17, FR-17, SPEC §7 / decision S1) ----------------
// These never touch the backend pipeline — the "manual" adapter always
// returns [] (decision S1). They live only here, merged into the real
// events.json list at render time (src/app.js's loadEvents), and dropped
// automatically once a real scrape produces the same id (AC-17).

const MANUAL_EVENTS_KEY = "gigradar:manual_events";

export function loadManualEvents() {
  try {
    const raw = localStorage.getItem(MANUAL_EVENTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistManualEvents(list) {
  localStorage.setItem(MANUAL_EVENTS_KEY, JSON.stringify(list));
}

function saveManualEventsList(list) {
  persistManualEvents(list);
  // Manual events aren't part of UserPrefs, but they ride along in the same
  // gist bundle (bundlePayload below) — bumping prefs.updated_at here is what
  // makes another device's reconcileGistSync() notice this change and pull it.
  savePrefs(loadPrefs());
}

/**
 * @param {object} fields - { date, time, headliners: string[], venue, city,
 *   ticketUrl, tagsType: string[], tagsOrigin: string[], note }
 */
export async function addManualEvent(fields) {
  const headliners = fields.headliners.filter(Boolean);
  const id = await computeEventId(headliners[0], fields.date, fields.venue);
  // AC-17: if this show turns out to have both a matinee and evening real
  // scrape later, dedup.mjs gives THOSE a bucket-suffixed id, not this bare
  // one — record every id a future scrape could produce so loadEvents() can
  // recognize either outcome and drop this manual copy (see src/id.js).
  const possibleRealIds = await computePossibleEventIds(headliners[0], fields.date, fields.venue, fields.time);
  const now = new Date().toISOString();

  const event = {
    id,
    merged_ids: [id],
    possible_real_ids: possibleRealIds,
    title_raw: headliners.join(" / "),
    headliners,
    lineup: headliners,
    is_festival: false,
    venue: fields.venue,
    city: fields.city || "未知",
    date: fields.date,
    time: fields.time || null,
    on_sale_at: null,
    price_min: null,
    price_max: null,
    status: "announced",
    tags_type: fields.tagsType ?? [],
    tags_origin: fields.tagsOrigin ?? [],
    ticket_url: fields.ticketUrl || "",
    sources: [{ name: "manual", url: fields.ticketUrl || "", raw_id: id }],
    first_seen_at: now,
    updated_at: now,
    note: fields.note || "",
  };

  const list = loadManualEvents();
  list.push(event);
  saveManualEventsList(list);
  return event;
}

export function removeManualEvent(id) {
  saveManualEventsList(loadManualEvents().filter((e) => e.id !== id));
}

// --- 待整理 dismissals (US-16, FR-16/61, SPEC M8) ------------------------
// "指派藝人"/"忽略" only ever produce a YAML snippet the user pastes into
// data/artists.yml by hand (SPEC §11 M8: writing that file back is a manual
// dev/commit action, not something this static frontend can do). This list
// just declutters the queue in THIS browser until the next `npm run fetch`
// naturally drops the item from needs-review.json — it's not synced anywhere.

const REVIEW_DISMISSED_KEY = "gigradar:review_dismissed";

export function loadReviewDismissed() {
  try {
    const raw = localStorage.getItem(REVIEW_DISMISSED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function dismissReviewItem(rawId) {
  const list = loadReviewDismissed();
  if (!list.includes(rawId)) {
    list.push(rawId);
    localStorage.setItem(REVIEW_DISMISSED_KEY, JSON.stringify(list));
  }
}

// --- Timeline view filters (city/month/priceMax chips, SPEC §6) --------
// Deliberately NOT part of UserPrefs (§3.3) and never synced via Gist —
// these are "what am I currently looking at" view state, not a durable
// rule like excluded_artists, so they stay local to this browser.

const VIEW_FILTERS_KEY = "gigradar:view_filters";

export function loadViewFilters() {
  try {
    const raw = localStorage.getItem(VIEW_FILTERS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveViewFilters(filters) {
  localStorage.setItem(VIEW_FILTERS_KEY, JSON.stringify(filters));
}

// --- Gist sync (M9, FR-65, SPEC §8) -------------------------------------
// The PAT lives in its own localStorage key — never inside `prefs`, so
// exporting prefs via FR-63 can never leak it, and it's never written into
// the gist content itself. Sync is last-write-wins on UserPrefs.updated_at
// (SPEC §8): whichever side has the newer timestamp overwrites the other,
// no field-level merge. Manual events (US-17) aren't part of UserPrefs but
// ride along in the same gist file so they sync too (see saveManualEventsList).

const GIST_TOKEN_KEY = "gigradar:gist_token";
const GIST_FILENAME = "gigradar-sync.json";
const GIST_DESCRIPTION = "GigRadar sync data (auto-generated by the app — do not edit by hand)";

export function loadGistToken() {
  try {
    return localStorage.getItem(GIST_TOKEN_KEY);
  } catch {
    return null;
  }
}

function bundlePayload(prefs) {
  return { prefs, manual_events: loadManualEvents() };
}

async function gistApi(token, method, path, body) {
  const res = await fetch(`https://api.github.com/gists${path}`, {
    method,
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Gist API ${method} ${path} -> ${res.status}`);
  return res.json();
}

/**
 * FR-65: connect once by pasting a `gist`-scoped PAT — no OAuth server (S2).
 * If this device already has a gist_id (reconnecting after a token change),
 * just verifies it. Otherwise looks for an existing GigRadar sync gist under
 * this GitHub account first — so pasting the SAME token on a second device
 * finds device A's gist instead of forking a separate copy — and only
 * creates a new one if none exists. Throws on failure; caller must not treat
 * that as "clear local data" (AC-65 negative test).
 */
export async function connectGistSync(token) {
  const local = loadPrefs();

  if (local.gist_id) {
    await gistApi(token, "GET", `/${local.gist_id}`);
    localStorage.setItem(GIST_TOKEN_KEY, token);
    return local;
  }

  const existingGists = await gistApi(token, "GET", "");
  const found = existingGists.find((g) => g.description === GIST_DESCRIPTION);
  localStorage.setItem(GIST_TOKEN_KEY, token);

  if (found) {
    const gist = await gistApi(token, "GET", `/${found.id}`);
    const remote = JSON.parse(gist.files[GIST_FILENAME].content);
    persistManualEvents(remote.manual_events ?? []);
    return persistPrefs({ ...remote.prefs, gist_id: found.id });
  }

  const created = await gistApi(token, "POST", "", {
    description: GIST_DESCRIPTION,
    public: false,
    files: { [GIST_FILENAME]: { content: JSON.stringify(bundlePayload(local)) } },
  });
  return persistPrefs({ ...local, gist_id: created.id });
}

export function disconnectGistSync() {
  localStorage.removeItem(GIST_TOKEN_KEY);
  return persistPrefs({ ...loadPrefs(), gist_id: null });
}

async function pushToGist(prefs) {
  const token = loadGistToken();
  if (!token || !prefs.gist_id) return;
  await gistApi(token, "PATCH", `/${prefs.gist_id}`, {
    files: { [GIST_FILENAME]: { content: JSON.stringify(bundlePayload(prefs)) } },
  });
}

let syncTimer = null;

function scheduleGistSync(prefs) {
  if (!prefs.gist_id) return; // not connected yet
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    pushToGist(prefs).catch((err) => console.error("Gist push failed:", err));
  }, 2000);
}

/**
 * AC-65: call once per page load. Pulls the remote bundle and keeps whichever
 * side is newer; pushes back if local won so the two sides converge. Never
 * throws — any network/auth failure just means "stay on local", which IS
 * AC-65's negative test, not an error the caller needs to handle specially.
 * @returns {{status: "not_connected"|"error"|"ok", changed: boolean}}
 */
export async function reconcileGistSync() {
  const local = loadPrefs();
  const token = loadGistToken();
  if (!token || !local.gist_id) return { status: "not_connected", changed: false };

  let remote;
  try {
    const gist = await gistApi(token, "GET", `/${local.gist_id}`);
    remote = JSON.parse(gist.files[GIST_FILENAME].content);
  } catch (err) {
    console.error("Gist sync failed, staying on local data:", err);
    return { status: "error", changed: false };
  }

  const remoteTime = new Date(remote.prefs.updated_at).getTime();
  const localTime = new Date(local.updated_at).getTime();

  if (remoteTime > localTime) {
    persistManualEvents(remote.manual_events ?? []);
    persistPrefs(remote.prefs);
    return { status: "ok", changed: true };
  }
  if (localTime > remoteTime) {
    await pushToGist(local).catch((err) => console.error("Gist push failed:", err));
  }
  return { status: "ok", changed: false };
}

// --- Backup export/import (FR-63/64) -----------------------------------

export function exportPrefsAsJson(prefs) {
  return JSON.stringify(prefs, null, 2);
}

export function importPrefsFromJson(json) {
  const parsed = JSON.parse(json);
  return savePrefs({ ...defaultPrefs(), ...parsed, last_backup_at: new Date().toISOString() });
}
