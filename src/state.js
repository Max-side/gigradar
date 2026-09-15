/**
 * UserPrefs persistence (SPEC §3.3, §8).
 * M1: localStorage read/write only. Gist sync (M9) plugs into syncToGist/syncFromGist below.
 */

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

export function savePrefs(prefs) {
  const next = { ...prefs, updated_at: new Date().toISOString() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
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
      !prefs.favorites.includes(e.id) &&
      (prefs.strict_mode ? e.lineup.includes(artistName) : e.headliners.includes(artistName))
  ).length;
}
export function countHiddenByType(tag, events, prefs) {
  return events.filter((e) => !prefs.favorites.includes(e.id) && e.tags_type.includes(tag)).length;
}

// --- Gist sync (M9 — not implemented yet) -----------------------------

let syncTimer = null;

function scheduleGistSync(prefs) {
  if (!prefs.gist_id) return; // not connected yet
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncToGist(prefs), 2000);
}

async function syncToGist(_prefs) {
  // TODO (M9): PATCH https://api.github.com/gists/{gist_id} with the PAT from
  // settings, body = { files: { "gigradar-prefs.json": { content: JSON.stringify(prefs) } } }.
  // On failure: leave localStorage untouched, surface a "同步失敗" indicator (AC-65).
}

export async function syncFromGist(_token, _gistId) {
  // TODO (M9): GET the gist, compare .updated_at against local prefs,
  // last-write-wins per SPEC §8. Never throw on network failure — return null
  // and let the caller keep using local state (AC-65 negative test).
  return null;
}

// --- Backup export/import (FR-63/64) -----------------------------------

export function exportPrefsAsJson(prefs) {
  return JSON.stringify(prefs, null, 2);
}

export function importPrefsFromJson(json) {
  const parsed = JSON.parse(json);
  return savePrefs({ ...defaultPrefs(), ...parsed, last_backup_at: new Date().toISOString() });
}
