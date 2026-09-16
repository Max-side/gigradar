import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { load as loadYaml } from "js-yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTISTS_PATH = path.join(__dirname, "..", "data", "artists.yml");
const VENUES_PATH = path.join(__dirname, "..", "data", "venues.yml");

const CITY_NAMES = [
  "台北", "新北", "桃園", "新竹", "苗栗", "台中", "彰化", "南投",
  "雲林", "嘉義", "台南", "高雄", "屏東", "宜蘭", "花蓮", "台東",
  "澎湖", "金門", "連江",
];

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

/** Find every known artist whose alias/canonical name appears in the raw title. */
export function matchArtists(titleRaw, artistsYml) {
  const matches = [];
  for (const entry of artistsYml) {
    const names = [entry.canonical, ...(entry.aliases ?? [])];
    if (names.some((n) => titleRaw.includes(n))) {
      matches.push(entry.canonical);
    }
  }
  return matches;
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
  const city = CITY_NAMES.find((c) => addressPart.startsWith(c)) ?? null;
  return { venue: venuePart, city };
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
  const entry = venuesYml.find((v) => venueRaw.includes(v.match));
  return { venue: venueRaw, city: entry?.city ?? null };
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
export function normalize(rawEvent, artistsYml, venuesYml = []) {
  const isTixcraft = rawEvent.source_name === "拓元";
  const dateParsed = isTixcraft ? parseTixcraftDate(rawEvent.date_raw) : parseKktixDate(rawEvent.date_raw);
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

  const { venue, city } = isTixcraft
    ? parseTixcraftVenue(rawEvent.venue_raw ?? "", venuesYml)
    : parseKktixVenue(rawEvent.venue_raw ?? "");
  const { min, max } = priceFromTickets(rawEvent.tickets_raw ?? []);
  const { status, on_sale_at } = statusFromTickets(rawEvent.tickets_raw ?? [], dateParsed.date);
  const originDefault = artistsYml.find((a) => a.canonical === headliners[0])?.tags_origin_default;

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
      tags_origin: originDefault ? [originDefault] : [],
      ticket_url: rawEvent.url,
      sources: [{ name: rawEvent.source_name, url: rawEvent.url, raw_id: rawEvent.raw_id }],
      first_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  };
}
