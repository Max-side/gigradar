import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { load as loadYaml } from "js-yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTISTS_PATH = path.join(__dirname, "..", "data", "artists.yml");
const VENUES_PATH = path.join(__dirname, "..", "data", "venues.yml");

// 台北/台中/台南/台東 have an official traditional-character variant
// (臺北/臺中/臺南/臺東) that real address/venue-name data actually uses —
// found via Ticket Plus, whose address field is consistently "臺北市"/
// "臺中市"/"臺南市", not "台北市"/"台中市"/"台南市". Normalizing 臺→台 once,
// up front, closes this off everywhere instead of special-casing each
// affected city — the first version of this fix (2026-09-17) instead
// enumerated 4 hardcoded regex alternations, which still left every OTHER
// place in the codebase doing the same 台/臺 comparison (venues.yml's plain
// substring match, kktix.mjs's SEARCH_VENUES) unfixed. Exported so those
// other call sites can share this instead of re-deriving it.
export function normalizeTraditionalChars(text) {
  return text.replace(/臺/g, "台");
}

const CITY_NAMES = [
  "台北", "新北", "桃園", "新竹", "苗栗", "台中", "彰化", "南投",
  "雲林", "嘉義", "台南", "高雄", "屏東", "宜蘭", "花蓮", "台東",
  "澎湖", "金門", "連江",
];

function cityFromAddress(address) {
  // Some sources (Ticket Plus) prefix the address with a postal code before
  // the city name (e.g. "100台北市中正區..." or the newer hyphenated
  // "100-01台北市...") — strip it so the startsWith checks below still match.
  const withoutPostalCode = normalizeTraditionalChars(address).replace(/^\d+(-\d+)?/, "");
  return CITY_NAMES.find((c) => withoutPostalCode.startsWith(c)) ?? null;
}

const TYPE_KEYWORDS = [
  ["音樂祭", "音樂祭"],
  ["見面會", "見面會"],
  ["簽唱會", "簽唱會"],
  ["音樂劇", "音樂劇"],
  ["巡迴", "巡迴"],
  ["Tour", "巡迴"],
  ["拼盤", "拼盤"],
  ["古典", "古典"],
];

export function loadArtists() {
  const raw = readFileSync(ARTISTS_PATH, "utf-8");
  return loadYaml(raw) ?? [];
}

export function loadVenues() {
  const raw = readFileSync(VENUES_PATH, "utf-8");
  return loadYaml(raw) ?? [];
}

const ASCII_WORD = /^[A-Za-z0-9]+$/;
function isAsciiWordChar(ch) {
  return ch !== undefined && /[A-Za-z0-9]/.test(ch);
}

/**
 * Finds `name` inside `titleRaw`, returning its index or null.
 *
 * A pure-ASCII/Latin name (e.g. "FLOW", "IVE", "ASCA") requires a word
 * boundary on both sides — three real, unrelated bugs this session were all
 * the same shape: a short Latin canonical silently matching as a substring of
 * an unrelated English word ("IVE" inside "LIVE", "ASCA" inside a
 * "...Brasca" alias, "FLOW" inside LE SSERAFIM's "PUREFLOW" tour name).
 * Renaming each offending canonical one at a time doesn't scale once
 * artists.yml has ~230 entries — this is the general fix. A CJK/mixed name
 * keeps plain substring matching: Chinese text has no spaces to define a
 * "word boundary" against, and an artist name embedded in a longer title
 * string is the normal, correct case there (see the ⚠️ short/common-word
 * comments already in artists.yml for known residual risk in that case).
 */
function findNameIndex(titleRaw, name) {
  if (!ASCII_WORD.test(name)) {
    const idx = titleRaw.indexOf(name);
    return idx === -1 ? null : idx;
  }
  let fromIndex = 0;
  while (true) {
    const idx = titleRaw.indexOf(name, fromIndex);
    if (idx === -1) return null;
    if (!isAsciiWordChar(titleRaw[idx - 1]) && !isAsciiWordChar(titleRaw[idx + name.length])) {
      return idx;
    }
    fromIndex = idx + 1;
  }
}

/**
 * Find every known artist whose alias/canonical name appears in the raw title.
 *
 * Order matters: headliners[0] is treated elsewhere as "the main act" (the
 * exclude-menu's displayed artist, the block-artist target, the tags_origin
 * pick before the fix below). Sorting by each match's first character
 * position IN THE TITLE — not by artists.yml's file order — is what makes
 * that "main act" the one actually billed first in the text, instead of
 * whichever artist happens to sit earliest in the data file. This only
 * mattered rarely with a 2-entry file; with ~230 entries, multi-headliner
 * bills are common enough that file-order was producing an effectively
 * arbitrary "main act" (found in review, 2026-09-17).
 */
export function matchArtists(titleRaw, artistsYml) {
  const matches = [];
  for (const entry of artistsYml) {
    const names = [entry.canonical, ...(entry.aliases ?? [])];
    let bestIndex = null;
    for (const n of names) {
      const idx = findNameIndex(titleRaw, n);
      if (idx !== null && (bestIndex === null || idx < bestIndex)) bestIndex = idx;
    }
    if (bestIndex !== null) {
      matches.push({ canonical: entry.canonical, position: bestIndex });
    }
  }
  return matches.sort((a, b) => a.position - b.position).map((m) => m.canonical);
}

/** "2026/09/16(周三) 20:00(+0800)" or "2026/09/16 20:00(+0800)" -> { date, time } */
export function parseKktixDate(dateRaw) {
  const m = dateRaw.match(/(\d{4})\/(\d{2})\/(\d{2})(?:\([^)]*\))?\s*(\d{2}:\d{2})?/);
  if (!m) return null;
  const [, y, mo, d, time] = m;
  return { date: `${y}-${mo}-${d}`, time: time ?? null };
}

/** "The Wall Live House / 台北市文山區羅斯福路四段200號B1" -> { venue, city } */
export function parseKktixVenue(venueRaw) {
  const [venuePart, addressPart = ""] = venueRaw.split("/").map((s) => s.trim());
  return { venue: venuePart, city: cityFromAddress(addressPart) };
}

/** "2027/05/01 (六)  ~ 2027/05/02 (日) " or "2026/12/10 (四)" -> { date, time: null } */
export function parseTixcraftDate(dateRaw) {
  const m = dateRaw.match(/(\d{4})\/(\d{2})\/(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return { date: `${y}-${mo}-${d}`, time: null };
}

/** No address on tixcraft's listing page — look the venue name up in venues.yml instead. */
export function parseTixcraftVenue(venueRaw, venuesYml) {
  // Normalize both sides so a venues.yml entry only needs one spelling —
  // "台北小巨蛋" now also matches a source that renders it "臺北小巨蛋"
  // without needing a second, parallel entry (see normalizeTraditionalChars).
  const normalizedVenue = normalizeTraditionalChars(venueRaw);
  const entry = venuesYml.find((v) => normalizedVenue.includes(normalizeTraditionalChars(v.match)));
  return { venue: venueRaw, city: entry?.city ?? null };
}

/**
 * "2026.09.19 (Sat.) 19:30 open / 20:00 start" -> { date, time: "20:00" }
 * (prefer the show's actual start time over doors-open); falls back to the
 * listing page's dateless "2026/09/18 (五)" -> { date, time: null } when the
 * detail page's freeform info block didn't have a date line at all.
 */
export function parseIndievoxDate(dateRaw) {
  // Organizer-authored freeform text uses at least three different date
  // formats in the wild: "2026.09.19", "2026 / 10 / 2" (spaced slashes), and
  // "2026年10月3日" (Chinese units, no punctuation) — all three found across
  // real events. Try Chinese-unit form first since its digits aren't
  // separated by "." or "/" at all and won't match the other pattern.
  const m =
    dateRaw.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/) ??
    dateRaw.match(/(\d{4})\s*[./]\s*(\d{1,2})\s*[./]\s*(\d{1,2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  const startMatch = dateRaw.match(/(\d{1,2}:\d{2})\s*start/i);
  const anyTimeMatch = dateRaw.match(/(\d{1,2}:\d{2})/);
  const time = (startMatch ?? anyTimeMatch)?.[1] ?? null;
  return { date, time };
}

/**
 * "WESTAR（台北市萬華區西門里漢中街116號8樓）" -> { venue: "WESTAR", city: "台北" }.
 * Organizer-authored freeform text: many events give a bare venue name with
 * no address at all (e.g. "野地方 Wildlab") — venues.yml (same table
 * tixcraft's untracked venues use) is the fallback for those.
 */
export function parseIndievoxVenue(venueRaw, venuesYml) {
  const m = venueRaw.match(/^(.*?)[（(]([^）)]+)[）)]/);
  if (m) {
    const [, venue, address] = m;
    return { venue: venue.trim(), city: cityFromAddress(address) };
  }
  return parseTixcraftVenue(venueRaw, venuesYml);
}

/**
 * "2027-01-09 ~ 2027-01-09 18:00 ~ 18:00" -> { date: "2027-01-09", time: "18:00" }.
 * Ticket Plus's sessions.json gives `date`/`time` as separate, already-clean
 * fields (dash-separated start~end ranges) — the adapter concatenates them
 * into one string since RawEvent only has a single date_raw slot, this just
 * pulls the start date/time back out. No freeform-text ambiguity to handle
 * here, unlike iNDIEVOX/FANSI GO — this is the one source with a real
 * structured API instead of scraped HTML.
 */
export function parseTicketPlusDate(dateRaw) {
  const dateMatch = dateRaw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!dateMatch) return null;
  const [, y, mo, d] = dateMatch;
  const timeMatch = dateRaw.match(/(\d{2}:\d{2})/);
  return { date: `${y}-${mo}-${d}`, time: timeMatch?.[1] ?? null };
}

function guessTagsType(titleRaw, headlinerCount) {
  for (const [kw, tag] of TYPE_KEYWORDS) {
    if (titleRaw.includes(kw)) return [tag];
  }
  return headlinerCount > 1 ? ["拼盤"] : ["專場"];
}

function priceFromTickets(ticketsRaw) {
  // Prefer tiers that are actually purchasable — a closed early-bird tier's
  // price shouldn't be shown as the current price_min. Only fall back to
  // closed tiers (for reference) when EVERY tier is closed, i.e. the event
  // is already sold out and there's no "current" price to speak of anyway.
  const openTickets = ticketsRaw.filter((t) => !t.closed);
  const relevant = openTickets.length > 0 ? openTickets : ticketsRaw;
  const prices = relevant.map((t) => t.price).filter((p) => typeof p === "number");
  if (prices.length === 0) return { min: null, max: null };
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

/**
 * "YYYY-MM-DD" for the current date in Taiwan time (UTC+8, no DST) — never
 * compare event dates via `new Date(dateStr) > new Date()`: the pipeline runs
 * in UTC (GitHub Actions, cron "0 0 * * *" = 08:00 Taiwan per D1), so a bare
 * date string parsed as UTC midnight sits ~8h behind the real Taiwan "today",
 * misclassifying every today-dated, sold-out show as already "ended" on
 * every single run. String comparison of two YYYY-MM-DD values is safe and
 * sidesteps timezone math entirely.
 */
function taiwanTodayDateStr() {
  const taiwanNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return taiwanNow.toISOString().slice(0, 10);
}

function statusFromTickets(ticketsRaw, eventDate) {
  const anyOpen = ticketsRaw.some((t) => !t.closed);
  if (anyOpen) return { status: "on_sale", on_sale_at: null };
  if (ticketsRaw.length === 0) return { status: "announced", on_sale_at: null };
  // All tiers closed. Can't distinguish "sold out" from "moved to door sales only" —
  // documented limitation, see SPEC §5.2.
  return { status: eventDate >= taiwanTodayDateStr() ? "sold_out" : "ended", on_sale_at: null };
}

/**
 * @param {object} rawEvent - shape returned by an adapter's fetch()
 * @param {object[]} artistsYml - loadArtists() result
 * @param {object[]} venuesYml - loadVenues() result (only used for sources
 *   whose listing has no address to derive city from, e.g. tixcraft)
 * @returns {{ event: object }|{ needsReview: object }}
 */
// FANSI GO's date_raw ("2026/09/19", no time) and venue_raw (bare name, no
// address — every event needs the venues.yml fallback) are shaped exactly
// like tixcraft's, so it reuses those parsers rather than duplicating them.
// Ticket Plus's venue_raw ("location / address") is shaped exactly like
// KKTIX's, so it reuses parseKktixVenue via the same default fallback below
// rather than needing its own entry — parseKktixVenue is also the map's
// fallback for any future source_name not listed here.
const DATE_PARSERS = {
  "拓元": parseTixcraftDate,
  "iNDIEVOX": parseIndievoxDate,
  "FANSI GO": parseTixcraftDate,
  "Ticket Plus": parseTicketPlusDate,
};
const VENUE_PARSERS = { "拓元": parseTixcraftVenue, "iNDIEVOX": parseIndievoxVenue, "FANSI GO": parseTixcraftVenue };

export function normalize(rawEvent, artistsYml, venuesYml = []) {
  const parseDate = DATE_PARSERS[rawEvent.source_name] ?? parseKktixDate;
  const parseVenue = VENUE_PARSERS[rawEvent.source_name] ?? parseKktixVenue;
  const dateParsed = parseDate(rawEvent.date_raw);
  if (!dateParsed) {
    return {
      needsReview: {
        raw_id: rawEvent.raw_id,
        title_raw: rawEvent.title_raw,
        url: rawEvent.url,
        source: rawEvent.source_name,
        reason: "date_unparseable",
        detail: rawEvent.date_raw,
      },
    };
  }

  const headliners = matchArtists(rawEvent.title_raw, artistsYml);
  if (headliners.length === 0) {
    return {
      needsReview: {
        raw_id: rawEvent.raw_id,
        title_raw: rawEvent.title_raw,
        url: rawEvent.url,
        source: rawEvent.source_name,
        reason: "artist_unrecognized",
        detail: null,
      },
    };
  }

  const { venue, city } = parseVenue(rawEvent.venue_raw ?? "", venuesYml);
  const { min, max } = priceFromTickets(rawEvent.tickets_raw ?? []);
  const { status, on_sale_at } = statusFromTickets(rawEvent.tickets_raw ?? [], dateParsed.date);
  // Union across ALL recognized headliners, not just headliners[0] — a
  // multi-artist bill (common now that artists.yml has ~230 entries) can mix
  // origins, and picking only the first-billed act's origin silently dropped
  // the others (found in review, 2026-09-17).
  const originTags = [
    ...new Set(
      headliners
        .map((h) => artistsYml.find((a) => a.canonical === h)?.tags_origin_default)
        .filter(Boolean),
    ),
  ];

  return {
    event: {
      title_raw: rawEvent.title_raw,
      headliners,
      lineup: headliners, // Phase 1: no co-performer parsing beyond alias matches found in the title
      is_festival: rawEvent.title_raw.includes("音樂祭"),
      venue,
      city: city ?? "未知",
      date: dateParsed.date,
      time: dateParsed.time,
      on_sale_at,
      price_min: min,
      price_max: max,
      status,
      tags_type: guessTagsType(rawEvent.title_raw, headliners.length),
      tags_origin: originTags,
      ticket_url: rawEvent.url,
      sources: [{ name: rawEvent.source_name, url: rawEvent.url, raw_id: rawEvent.raw_id }],
      first_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  };
}
